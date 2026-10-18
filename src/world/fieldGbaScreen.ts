// The overworld on the GBA layer, for the screens that work on the field's own video registers (battle
// transitions). The field is normally drawn by Phaser; while this runs, its maps are put into VRAM the
// way overworld.c sets them up (InitOverworldBgs, InitOverworldGraphicsRegisters, CopyMapTilesetsToVram,
// LoadMapTilesetPalettes), field_camera.c's DrawWholeMapView fills BG1-3 every frame and the software
// PPU draws the result over the field.
//
// Object sprites stay Phaser's: each frame they're copied into the PPU's OBJ bitmap layer. Their
// colours go through two probe OBJ palettes (a 0-31 grey ramp), so palette fades and blends reach them
// as they would the objects' own palettes.

import Phaser from 'phaser';
import type { TilesetSymbols } from '../data/types';
import { BG_ATTR_MOSAIC, CopyBgTilemapBufferToVram, InitBgsFromTemplates, ResetBgsAndClearDma3BusyFlags, SetBgAttribute, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx16 } from '../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT2_BG1,
  BLDCNT_TGT2_BG2,
  BLDCNT_TGT2_BG3,
  BLDCNT_TGT2_OBJ,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  DISPCNT_WIN1_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  pltt,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_MOSAIC,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  resetHardware,
  SetGpuReg,
  vram,
  WIN_RANGE,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG_ALL,
  WININ_WIN1_OBJ,
  WINOUT_WIN01_BG0,
} from '../gba/hw';
import { gMain, SetHBlankCallback, SetVBlankCallback } from '../gba/main';
import { BG_PLTT_ID, LoadPalette, OBJ_PLTT_OFFSET, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { renderFrame, setObjBitmapLayer, type ObjBitmapLayer } from '../gba/ppu';
import { ScanlineEffect_Clear, ScanlineEffect_InitHBlankDmaTransfer } from '../gba/scanline';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, LoadSpritePalette, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { ResetTasks, RunTasks } from '../gba/task';
import { NUM_METATILES_IN_PRIMARY } from './TilesetPair';
import { NUM_TILES_IN_PRIMARY, tilesetVram } from './TilesetVram';
import { TransferTilesetAnimsBuffer } from './tilesetAnims';
import { InitCurrentFlashLevelScanlineEffect } from './flash';

/** What the field gives the GBA screen each frame. */
export interface FieldGbaSource {
  /** gMapHeader.mapLayout's tilesets: their tilesetVram store names and GBA symbols. */
  primary: { name: string; symbols: TilesetSymbols };
  secondary: { name: string; symbols: TilesetSymbols };
  /** MapGridGetMetatileIdAt / MapGridGetMetatileLayerTypeAt, in world tile coordinates. */
  metatileAt(x: number, y: number): number;
  layerType(metatile: number): number;
  /** The camera's top-left corner in world pixels. */
  camera(): { x: number; y: number };
  /** The field's object sprites (what OAM would hold) with their OAM priority, back to front. */
  sprites(): { sprite: Phaser.GameObjects.Sprite; priority: number }[];
  /** gSaveBlock1Ptr->flashLevel: a dark cave's circle stays on WIN0 through the transition. */
  flashLevel?: number;
}

/** The tileset palettes the screen loads (preload them before `start`). */
export function fieldGbaScreenGfxSymbols(source: Pick<FieldGbaSource, 'primary' | 'secondary'>): string[] {
  return [source.primary.symbols.palettes, source.secondary.symbols.palettes, source.primary.symbols.metatiles, source.secondary.symbols.metatiles];
}

// include/fieldmap.h
const NUM_TILES_TOTAL = 1024;
const NUM_METATILES_TOTAL = 1024;
const NUM_PALS_IN_PRIMARY = 7;
const NUM_PALS_TOTAL = 13;
const NUM_TILES_PER_METATILE = 8;

// global.fieldmap.h
const METATILE_LAYER_TYPE_NORMAL = 0;
const METATILE_LAYER_TYPE_COVERED = 1;
const METATILE_LAYER_TYPE_SPLIT = 2;

/** sOverworldBgTemplates */
const sOverworldBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 2, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0x000 },
  { bg: 2, charBaseIndex: 0, mapBaseIndex: 28, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0x000 },
  { bg: 3, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
];

/** gOverworldBackgroundLayerFlags */
const gOverworldBackgroundLayerFlags = [0, BLDCNT_TGT2_BG1, BLDCNT_TGT2_BG2, BLDCNT_TGT2_BG3];

/** The probe palettes' tags (any tag no sprite palette uses). */
const PROBE_PAL_TAGS = [0xfff0, 0xfff1];

const TEXTURE = 'field_gba_screen';

export class FieldGbaScreen {
  private readonly image: Phaser.GameObjects.Image;
  private readonly canvas: Phaser.Textures.CanvasTexture;
  private readonly frameData: ImageData;
  private readonly pixels: Uint32Array;
  private readonly objCanvas: HTMLCanvasElement;
  private readonly objCtx: CanvasRenderingContext2D;
  private readonly objLayer: ObjBitmapLayer = { color: new Int32Array(DISPLAY_WIDTH * DISPLAY_HEIGHT), priority: new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT) };
  /** gBGTilemapBuffers2 (BG1), gBGTilemapBuffers1 (BG2), gBGTilemapBuffers3 (BG3) */
  private readonly bgTilemapBuffers2 = new Uint16Array(0x400);
  private readonly bgTilemapBuffers1 = new Uint16Array(0x400);
  private readonly bgTilemapBuffers3 = new Uint16Array(0x400);
  private source?: FieldGbaSource;
  private running = false;
  /** The probe palettes' OBJ palette slots (looked up once: a reserved count can hide them from tag lookups). */
  private probeSlots = [0, 1];
  /** sFieldCameraOffset as this screen frames the camera: BG1-3's scroll. */
  private scroll = { x: 0, y: 0 };

  constructor(scene: Phaser.Scene, depth: number) {
    this.canvas = scene.textures.exists(TEXTURE) ? (scene.textures.get(TEXTURE) as Phaser.Textures.CanvasTexture) : scene.textures.createCanvas(TEXTURE, DISPLAY_WIDTH, DISPLAY_HEIGHT)!;
    this.frameData = this.canvas.context.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);
    this.pixels = new Uint32Array(this.frameData.data.buffer);
    this.image = scene.add.image(0, 0, TEXTURE).setOrigin(0, 0).setScrollFactor(0).setDepth(depth).setVisible(false);
    this.objCanvas = document.createElement('canvas');
    this.objCanvas.width = DISPLAY_WIDTH;
    this.objCanvas.height = DISPLAY_HEIGHT;
    this.objCtx = this.objCanvas.getContext('2d', { willReadFrequently: true })!;
    this.objCtx.imageSmoothingEnabled = false;
  }

  get active(): boolean {
    return this.running;
  }

  /** Dev: the share of the last frame's pixels that are black (0..1). */
  blackFraction(): number {
    let black = 0;
    for (const p of this.pixels) if ((p & 0xffffff) === 0) black++;
    return black / this.pixels.length;
  }

  /** FieldCameraGetPixelOffsetAtGround */
  cameraPixelOffset(): { x: number; y: number } {
    return { ...this.scroll };
  }

  /**
   * Draw the GBA layer over the field without the field on it, for screens that replace it
   * (CB2_DoChangeMap's transitions): the caller sets up the hardware.
   */
  startBare(): void {
    this.source = undefined;
    this.running = true;
    setObjBitmapLayer(null);
  }

  /** Put the field on the GBA layer; from the next `frame` it's drawn over the Phaser field. */
  start(source: FieldGbaSource): void {
    this.source = source;
    this.running = true;
    SetVBlankCallback(null);
    SetHBlankCallback(null);
    resetHardware();
    ResetTasks();
    ResetSpriteData();
    FreeAllSpritePalettes();
    ResetPaletteFade();
    ScanlineEffect_Clear();
    // The field's own sprite palettes: the probes stand in for them.
    this.probeSlots = PROBE_PAL_TAGS.map((tag, i) => {
      const ramp = Array.from({ length: 16 }, (_, j) => {
        const v = i * 16 + j;
        return v | (v << 5) | (v << 10);
      });
      return LoadSpritePalette({ data: ramp, tag });
    });
    this.loadField(source);
  }

  /**
   * Another map on the running GBA layer, keeping its tasks, sprites and OBJ palettes (credits.c's map scenes:
   * MapLdr_Credits): InitOverworldBgs, InitOverworldGraphicsRegisters, the map's tilesets, palettes and view.
   */
  reloadField(source: FieldGbaSource): void {
    this.running = true;
    this.loadField(source);
  }

  private loadField(source: FieldGbaSource): void {
    this.source = source;
    // InitOverworldBgs
    ResetBgsAndClearDma3BusyFlags(false);
    InitBgsFromTemplates(0, sOverworldBgTemplates);
    SetBgAttribute(1, BG_ATTR_MOSAIC, 1);
    SetBgAttribute(2, BG_ATTR_MOSAIC, 1);
    SetBgAttribute(3, BG_ATTR_MOSAIC, 1);
    SetBgTilemapBuffer(1, this.bgTilemapBuffers2);
    SetBgTilemapBuffer(2, this.bgTilemapBuffers1);
    SetBgTilemapBuffer(3, this.bgTilemapBuffers3);

    // InitOverworldGraphicsRegisters
    SetGpuReg(REG_OFFSET_MOSAIC, 0);
    SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ);
    SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG0 | (WINOUT_WIN01_BG0 << 8)); // WINOUT_WIN01_BG0 | WINOUT_WINOBJ_BG0
    SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, 255));
    SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(0, 255));
    SetGpuReg(REG_OFFSET_WIN1H, WIN_RANGE(255, 255));
    SetGpuReg(REG_OFFSET_WIN1V, WIN_RANGE(255, 255));
    SetGpuReg(REG_OFFSET_BLDCNT, gOverworldBackgroundLayerFlags[1] | gOverworldBackgroundLayerFlags[2] | gOverworldBackgroundLayerFlags[3] | BLDCNT_TGT2_OBJ | BLDCNT_EFFECT_BLEND);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(13, 7));
    SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | 0x20 | DISPCNT_OBJ_ON | DISPCNT_WIN0_ON | DISPCNT_WIN1_ON);
    for (let bg = 0; bg < 4; bg++) ShowBg(bg);
    InitCurrentFlashLevelScanlineEffect(source.flashLevel ?? 0); // the field's flash circle, still running

    this.loadMapTilesetPalettes();
    this.copyMapTilesetsToVram();
    this.drawWholeMapView();
    this.fieldUpdateBgTilemapScroll();
    TransferPlttBuffer();
    SetVBlankCallback(() => this.vblankCbField());
    setObjBitmapLayer(this.objLayer);
  }

  /** Stop drawing: the field shows again (the caller has usually left it black). */
  stop(): void {
    this.source = undefined;
    this.running = false;
    SetVBlankCallback(null);
    SetHBlankCallback(null);
    setObjBitmapLayer(null);
    this.image.setVisible(false);
  }

  /**
   * One frame: the GBA half of CB2_OverworldBasic (the field's own logic has already run), VBlank, then
   * the PPU draws the field as the registers now show it.
   */
  frame(): void {
    if (!this.running) return;
    RunTasks();
    AnimateSprites();
    BuildOamBuffer();
    UpdatePaletteFade();
    if (this.source) this.drawWholeMapView(); // the camera may have moved; DoScheduledBgTilemapCopiesToVram
    gMain.vblankCallback?.();
    if (!this.running) return;
    if (this.source) {
      this.copyMapTilesetsToVram(); // the tiles tile animations have written so far
      this.drawObjects();
    }
    renderFrame(this.pixels);
    this.canvas.context.putImageData(this.frameData, 0, 0);
    this.canvas.refresh();
    this.image.setVisible(true); // only once there's a frame of this run to show
  }

  /** VBlankCB_Field */
  private vblankCbField(): void {
    // LoadOam: the PPU reads the OAM buffer directly
    ProcessSpriteCopyRequests();
    ScanlineEffect_InitHBlankDmaTransfer();
    this.fieldUpdateBgTilemapScroll();
    TransferPlttBuffer();
    TransferTilesetAnimsBuffer();
  }

  /** CopyMapTilesetsToVram: the tiles as tilesetVram holds them (animated frames included). */
  private copyMapTilesetsToVram(): void {
    const { primary, secondary } = this.source!;
    const p = tilesetVram.tiles(primary.name);
    if (p) vram.set(p.subarray(0, NUM_TILES_IN_PRIMARY * 32), 0);
    const s = tilesetVram.tiles(secondary.name);
    if (s) vram.set(s.subarray(0, (NUM_TILES_TOTAL - NUM_TILES_IN_PRIMARY) * 32), NUM_TILES_IN_PRIMARY * 32);
  }

  /** LoadMapTilesetPalettes (LoadTilesetPalette: the primary's first colour is forced to black) */
  private loadMapTilesetPalettes(): void {
    const { primary, secondary } = this.source!;
    const primaryPals = gfx16(primary.symbols.palettes);
    LoadPalette([0], BG_PLTT_ID(0), 2);
    LoadPalette(primaryPals.subarray(1), BG_PLTT_ID(0) + 1, NUM_PALS_IN_PRIMARY * PLTT_SIZE_4BPP - 2);
    const secondaryPals = gfx16(secondary.symbols.palettes);
    LoadPalette(secondaryPals.subarray(NUM_PALS_IN_PRIMARY * 16), BG_PLTT_ID(NUM_PALS_IN_PRIMARY), (NUM_PALS_TOTAL - NUM_PALS_IN_PRIMARY) * PLTT_SIZE_4BPP);
    // What the field loaded over them since (tilesetVram.loadBgPalette: the league lighting's palette 7), from
    // the JASC colours back to BGR555 as gbagfx converts them (8 bits >> 3).
    for (const ts of [primary, secondary]) {
      for (const [slot, rgb] of tilesetVram.bgPaletteOverrides(ts.name)) {
        if (slot < NUM_PALS_IN_PRIMARY !== (ts === primary)) continue;
        const bgr555 = Array.from({ length: 16 }, (_, i) => (rgb[i * 3] >> 3) | ((rgb[i * 3 + 1] >> 3) << 5) | ((rgb[i * 3 + 2] >> 3) << 10));
        LoadPalette(bgr555, BG_PLTT_ID(slot), PLTT_SIZE_4BPP);
      }
    }
  }

  /**
   * The camera framed as on the GBA: the BG ring buffer starts at metatile row camera - 40 px (the 32 px
   * vertical pan + 8), so BG1-3 scroll by the camera's offset into that metatile.
   */
  private ringOrigin(): { x: number; y: number; hofs: number; vofs: number } {
    const cam = this.source!.camera();
    const x = Math.floor(cam.x / 16);
    const y = Math.floor((cam.y - 40) / 16);
    return { x, y, hofs: cam.x - x * 16, vofs: cam.y - y * 16 };
  }

  /** FieldUpdateBgTilemapScroll */
  private fieldUpdateBgTilemapScroll(): void {
    const { hofs, vofs } = this.ringOrigin();
    this.scroll = { x: hofs, y: vofs };
    SetGpuReg(REG_OFFSET_BG1HOFS, hofs);
    SetGpuReg(REG_OFFSET_BG1VOFS, vofs);
    SetGpuReg(REG_OFFSET_BG2HOFS, hofs);
    SetGpuReg(REG_OFFSET_BG2VOFS, vofs);
    SetGpuReg(REG_OFFSET_BG3HOFS, hofs);
    SetGpuReg(REG_OFFSET_BG3VOFS, vofs);
  }

  /** DrawWholeMapView, with the ring buffer's tile offsets at 0 */
  private drawWholeMapView(): void {
    const { x, y } = this.ringOrigin();
    const primary = gfx16(this.source!.primary.symbols.metatiles);
    const secondary = gfx16(this.source!.secondary.symbols.metatiles);
    for (let i = 0; i < 32; i += 2) {
      for (let j = 0; j < 32; j += 2) this.drawMetatileAt(primary, secondary, i * 32 + j, x + j / 2, y + i / 2);
    }
    CopyBgTilemapBufferToVram(1);
    CopyBgTilemapBufferToVram(2);
    CopyBgTilemapBufferToVram(3);
  }

  /** DrawMetatileAt */
  private drawMetatileAt(primary: Uint16Array, secondary: Uint16Array, offset: number, x: number, y: number): void {
    const source = this.source!;
    let metatileId = source.metatileAt(x, y);
    const layerType = source.layerType(metatileId);
    if (metatileId > NUM_METATILES_TOTAL) metatileId = 0;
    if (metatileId < NUM_METATILES_IN_PRIMARY) this.drawMetatile(layerType, primary, metatileId * NUM_TILES_PER_METATILE, offset);
    else this.drawMetatile(layerType, secondary, (metatileId - NUM_METATILES_IN_PRIMARY) * NUM_TILES_PER_METATILE, offset);
  }

  /** DrawMetatile */
  private drawMetatile(metatileLayerType: number, tiles: Uint16Array, t: number, offset: number): void {
    const bg3 = this.bgTilemapBuffers3;
    const bg2 = this.bgTilemapBuffers1;
    const bg1 = this.bgTilemapBuffers2;
    const put = (dest: Uint16Array, a: number, b: number, c: number, d: number) => {
      dest[offset] = a;
      dest[offset + 1] = b;
      dest[offset + 0x20] = c;
      dest[offset + 0x21] = d;
    };
    const tile = (i: number) => tiles[t + i] ?? 0;
    switch (metatileLayerType) {
      case METATILE_LAYER_TYPE_SPLIT:
        // Draw metatile's bottom layer to the bottom background layer.
        put(bg3, tile(0), tile(1), tile(2), tile(3));
        // Draw transparent tiles to the middle background layer.
        put(bg2, 0, 0, 0, 0);
        // Draw metatile's top layer to the top background layer.
        put(bg1, tile(4), tile(5), tile(6), tile(7));
        break;
      case METATILE_LAYER_TYPE_COVERED:
        // Draw metatile's bottom layer to the bottom background layer.
        put(bg3, tile(0), tile(1), tile(2), tile(3));
        // Draw metatile's top layer to the middle background layer.
        put(bg2, tile(4), tile(5), tile(6), tile(7));
        // Draw transparent tiles to the top background layer.
        put(bg1, 0, 0, 0, 0);
        break;
      case METATILE_LAYER_TYPE_NORMAL:
        // Draw garbage to the bottom background layer.
        put(bg3, 0x3014, 0x3014, 0x3014, 0x3014);
        // Draw metatile's bottom layer to the middle background layer.
        put(bg2, tile(0), tile(1), tile(2), tile(3));
        // Draw metatile's top layer to the top background layer, which covers object event sprites.
        put(bg1, tile(4), tile(5), tile(6), tile(7));
        break;
    }
  }

  /**
   * The field's sprites into the PPU's OBJ layer, one priority band at a time (back to front, so a
   * band in front overwrites the ones behind), coloured through the probe palettes.
   */
  private drawObjects(): void {
    const { color, priority } = this.objLayer;
    color.fill(-1);
    const cam = this.source!.camera();
    const ctx = this.objCtx;
    // The probes' faded colours: each channel value v of an object pixel shows as the probe for v does.
    const lut = [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)];
    for (let v = 0; v < 32; v++) {
      const c = pltt[OBJ_PLTT_OFFSET + this.probeSlots[v >> 4] * 16 + (v & 15)];
      lut[0][v] = c & 0x1f;
      lut[1][v] = (c >> 5) & 0x1f;
      lut[2][v] = (c >> 10) & 0x1f;
    }
    const sprites = this.source!.sprites();
    for (const band of [3, 2, 1]) {
      const inBand = sprites.filter((s) => s.priority === band);
      if (!inBand.length) continue;
      ctx.clearRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
      for (const { sprite } of inBand) drawSprite(ctx, sprite, cam.x, cam.y);
      const rgba = ctx.getImageData(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT).data;
      for (let i = 0, p = 0; i < color.length; i++, p += 4) {
        if (rgba[p + 3] < 128) continue;
        color[i] = lut[0][rgba[p] >> 3] | (lut[1][rgba[p + 1] >> 3] << 5) | (lut[2][rgba[p + 2] >> 3] << 10);
        priority[i] = band;
      }
    }
  }
}

/** A Phaser sprite as it would be drawn on screen (position, origin, scale and flips). */
function drawSprite(ctx: CanvasRenderingContext2D, s: Phaser.GameObjects.Sprite, camX: number, camY: number): void {
  const f = s.frame;
  const w = f.cutWidth;
  const h = f.cutHeight;
  ctx.save();
  ctx.translate(Math.round(s.x - camX * s.scrollFactorX), Math.round(s.y - camY * s.scrollFactorY));
  ctx.scale(s.scaleX, s.scaleY);
  ctx.translate(-s.displayOriginX, -s.displayOriginY);
  if (s.flipX || s.flipY) {
    ctx.translate(s.flipX ? w : 0, s.flipY ? h : 0);
    ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
  }
  ctx.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, w, h, 0, 0, w, h);
  ctx.restore();
}
