// battle_interface.c: healthboxes (built from sprite tiles that the code rewrites in OBJ VRAM),
// HP/EXP bars, status icons and the party status summary (ball tray). The HP-as-text path that
// only doubles/Japanese use (RenderTextHandleBold) isn't implemented.

import { gfx, gfx16 } from '../gba/gfx';
import { BLDALPHA_BLEND, BLDCNT_EFFECT_BLEND, BLDCNT_TGT2_ALL, DISPLAY_WIDTH, OBJ_VRAM0, pltt, REG_OFFSET_BLDALPHA, REG_OFFSET_BLDCNT, RGB, SetGpuReg, vram } from '../gba/hw';
import { FillPalette, gPlttBufferUnfaded, OBJ_PLTT_OFFSET, PLTT_ID } from '../gba/palette';
import {
  CreateSprite,
  CreateSpriteAtEnd,
  DestroySprite,
  DestroySpriteAndFreeResources,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  gSprites,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  SetSubspriteTables,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  SUBSPRITES_IGNORE_PRIORITY,
  TILE_SIZE_4BPP,
  type Sprite,
  type SpriteTemplate,
  type Subsprite,
  type SubspriteTable,
} from '../gba/sprite';
import { PlaySE12WithPanning, PlaySE1WithPanning, PlaySE2WithPanning } from '../gba/sound';
import { CreateTask, DestroyTask, gTasks, TaskDummy, type TaskFunc } from '../gba/task';
import { AddTextPrinterParameterized4, AddWindow, FillWindowPixelBuffer, GetStringWidth, gWindows, PIXEL_FILL, RemoveWindow, TEXT_SKIP_DRAW } from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import { K } from './constants';
import { charmap, g, gSpeciesInfo, pokemon, state } from './env';
import { encodeBattleText } from './message';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEFT_ALIGN, STR_CONV_MODE_RIGHT_ALIGN } from './stringUtil';
import { getBattlerPosition, getBattlerSide } from './util';
import type { HpAndStatus } from './structs';

// Indexes of tiles in gBattleInterface_Gfx
const B_INTERFACE_GFX_TRANSPARENT = 0;
const B_INTERFACE_GFX_HP_BAR_HP_TEXT = 1;
const B_INTERFACE_GFX_HP_BAR_GREEN = 3;
const B_INTERFACE_GFX_EXP_BAR = 12;
const B_INTERFACE_GFX_STATUS_PSN_BATTLER0 = 21;
const B_INTERFACE_GFX_STATUS_PAR_BATTLER0 = 24;
const B_INTERFACE_GFX_STATUS_SLP_BATTLER0 = 27;
const B_INTERFACE_GFX_STATUS_FRZ_BATTLER0 = 30;
const B_INTERFACE_GFX_STATUS_BRN_BATTLER0 = 33;
const B_INTERFACE_GFX_STATUS_NONE = 39;
const B_INTERFACE_GFX_HP_BAR_YELLOW = 47;
const B_INTERFACE_GFX_HP_BAR_RED = 56;
const B_INTERFACE_GFX_HP_BAR_LEFT_BORDER = 65;
const B_INTERFACE_GFX_BALL_PARTY_SUMMARY = 66;
const B_INTERFACE_GFX_BALL_CAUGHT = 70;
const B_INTERFACE_GFX_STATUS_PSN_BATTLER1 = 71;
const B_INTERFACE_GFX_STATUS_PAR_BATTLER1 = 74;
const B_INTERFACE_GFX_STATUS_SLP_BATTLER1 = 77;
const B_INTERFACE_GFX_STATUS_FRZ_BATTLER1 = 80;
const B_INTERFACE_GFX_STATUS_BRN_BATTLER1 = 83;
const B_INTERFACE_GFX_STATUS_PSN_BATTLER2 = 86;
const B_INTERFACE_GFX_STATUS_PAR_BATTLER2 = 89;
const B_INTERFACE_GFX_STATUS_SLP_BATTLER2 = 92;
const B_INTERFACE_GFX_STATUS_FRZ_BATTLER2 = 95;
const B_INTERFACE_GFX_STATUS_BRN_BATTLER2 = 98;
const B_INTERFACE_GFX_STATUS_PSN_BATTLER3 = 101;
const B_INTERFACE_GFX_STATUS_PAR_BATTLER3 = 104;
const B_INTERFACE_GFX_STATUS_SLP_BATTLER3 = 107;
const B_INTERFACE_GFX_STATUS_FRZ_BATTLER3 = 110;
const B_INTERFACE_GFX_STATUS_BRN_BATTLER3 = 113;
const B_INTERFACE_GFX_BOTTOM_RIGHT_CORNER_HP_AS_TEXT = 116;

const B_HEALTHBAR_NUM_PIXELS = 48;
const B_HEALTHBAR_NUM_TILES = B_HEALTHBAR_NUM_PIXELS / 8;
const B_EXPBAR_NUM_TILES = 64 / 8;

const HEALTHBAR_TYPE_PLAYER_SINGLE = 0;
const HEALTHBAR_TYPE_PLAYER_DOUBLE = 1;
const HEALTHBAR_TYPE_OPPONENT = 2;

const isDoubleBattle = () => (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) !== 0;

/** gBattleInterface_Gfx[element] */
function GetBattleInterfaceGfxPtr(elementId: number): Uint8Array {
  return gfx('gBattleInterface_Gfx').subarray(elementId * 32);
}

/** CpuCopy32 into OBJ VRAM at byte offset `dest`. */
function copyToObjVram(src: Uint8Array, dest: number, size: number): void {
  vram.set(src.subarray(0, size), OBJ_VRAM0 + dest);
}

function fillObjVram(dest: number, size: number): void {
  vram.fill(0, OBJ_VRAM0 + dest, OBJ_VRAM0 + dest + size);
}

// Sprite data fields
const sHealthBarSpriteId = 5;
const sBattlerId = 6;
const sHealthboxSpriteId = 5;
const sHealthbarType = 6;

const sOamData_Healthbox = oam({ shape: SPRITE_SHAPE['64x32'][0], size: SPRITE_SHAPE['64x32'][1], priority: 1 });
const sOamData_Healthbar = oam({ shape: SPRITE_SHAPE['32x8'][0], size: SPRITE_SHAPE['32x8'][1], priority: 1 });

const tmpl = (tileTag: number, paletteTag: number, o: typeof sOamData_Healthbox, callback = SpriteCallbackDummy): SpriteTemplate => ({
  tileTag,
  paletteTag,
  oam: o,
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback,
});

let templates: ReturnType<typeof makeTemplates> | undefined;
function makeTemplates() {
  return {
    healthboxPlayer: [tmpl(K.TAG_HEALTHBOX_PLAYER1_TILE, K.TAG_HEALTHBOX_PAL, sOamData_Healthbox), tmpl(K.TAG_HEALTHBOX_PLAYER2_TILE, K.TAG_HEALTHBOX_PAL, sOamData_Healthbox)],
    healthboxOpponent: [tmpl(K.TAG_HEALTHBOX_OPPONENT1_TILE, K.TAG_HEALTHBOX_PAL, sOamData_Healthbox), tmpl(K.TAG_HEALTHBOX_OPPONENT2_TILE, K.TAG_HEALTHBOX_PAL, sOamData_Healthbox)],
    healthboxSafari: tmpl(K.TAG_HEALTHBOX_SAFARI_TILE, K.TAG_HEALTHBOX_PAL, sOamData_Healthbox),
    // indexed by battler position
    healthbar: [
      tmpl(K.TAG_HEALTHBAR_PLAYER1_TILE, K.TAG_HEALTHBAR_PAL, sOamData_Healthbar, SpriteCB_HealthBar),
      tmpl(K.TAG_HEALTHBAR_OPPONENT1_TILE, K.TAG_HEALTHBAR_PAL, sOamData_Healthbar, SpriteCB_HealthBar),
      tmpl(K.TAG_HEALTHBAR_PLAYER2_TILE, K.TAG_HEALTHBAR_PAL, sOamData_Healthbar, SpriteCB_HealthBar),
      tmpl(K.TAG_HEALTHBAR_OPPONENT2_TILE, K.TAG_HEALTHBAR_PAL, sOamData_Healthbar, SpriteCB_HealthBar),
    ],
    partySummaryBar: [
      tmpl(K.TAG_PARTY_SUMMARY_BAR_PLAYER_TILE, K.TAG_PARTY_SUMMARY_BAR_PLAYER_PAL, sOamData_Healthbox, SpriteCB_PartySummaryBar),
      tmpl(K.TAG_PARTY_SUMMARY_BAR_OPPONENT_TILE, K.TAG_PARTY_SUMMARY_BAR_OPPONENT_PAL, sOamData_Healthbox, SpriteCB_PartySummaryBar),
    ],
    partySummaryBall: [
      tmpl(K.TAG_PARTY_SUMMARY_BALL_PLAYER_TILE, K.TAG_PARTY_SUMMARY_BALL_PLAYER_PAL, oam({ shape: 0, size: 0, priority: 1 }), SpriteCB_PartySummaryBall_OnBattleStart),
      tmpl(K.TAG_PARTY_SUMMARY_BALL_OPPONENT_TILE, K.TAG_PARTY_SUMMARY_BALL_OPPONENT_PAL, oam({ shape: 0, size: 0, priority: 1 }), SpriteCB_PartySummaryBall_OnBattleStart),
    ],
  };
}
const T = () => (templates ??= makeTemplates());

const sub = (x: number, y: number, shapeSize: readonly [number, number], tileOffset: number, priority = 1): Subsprite => ({
  x,
  y,
  shape: shapeSize[0],
  size: shapeSize[1],
  tileOffset,
  priority,
});

/** sHealthBar_SubspriteTable */
const sHealthBar_SubspriteTable: SubspriteTable[] = [
  { subspriteCount: 2, subsprites: [sub(-16, 0, SPRITE_SHAPE['32x8'], 0), sub(16, 0, SPRITE_SHAPE['32x8'], 4)] },
  { subspriteCount: 3, subsprites: [sub(-16, 0, SPRITE_SHAPE['32x8'], 0), sub(16, 0, SPRITE_SHAPE['32x8'], 4), sub(-32, 0, SPRITE_SHAPE['8x8'], 8)] },
];

const sStatusSummaryBar_SubspriteTable_Enter: SubspriteTable[] = [
  { subspriteCount: 4, subsprites: [sub(-96, 0, SPRITE_SHAPE['32x8'], 0), sub(-64, 0, SPRITE_SHAPE['32x8'], 4), sub(-32, 0, SPRITE_SHAPE['32x8'], 8), sub(0, 0, SPRITE_SHAPE['32x8'], 12)] },
];

const sStatusSummaryBar_SubspriteTable_Exit: SubspriteTable[] = [
  {
    subspriteCount: 6,
    subsprites: [
      sub(-96, 0, SPRITE_SHAPE['32x8'], 0),
      sub(-64, 0, SPRITE_SHAPE['32x8'], 4),
      sub(-32, 0, SPRITE_SHAPE['32x8'], 8),
      sub(0, 0, SPRITE_SHAPE['32x8'], 8),
      sub(32, 0, SPRITE_SHAPE['32x8'], 8),
      sub(64, 0, SPRITE_SHAPE['32x8'], 12),
    ],
  },
];

/** CreateBattlerHealthboxSprites */
export function CreateBattlerHealthboxSprites(battlerId: number): number {
  let healthbarType = HEALTHBAR_TYPE_PLAYER_SINGLE;
  let healthboxSpriteId: number;
  let healthboxOtherSpriteId: number;
  if (!isDoubleBattle()) {
    if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) {
      healthboxSpriteId = CreateSprite(T().healthboxPlayer[0], 240, 160, 1);
      healthboxOtherSpriteId = CreateSpriteAtEnd(T().healthboxPlayer[0], 240, 160, 1);
      gSprites[healthboxSpriteId].oam.shape = SPRITE_SHAPE['64x64'][0];
      gSprites[healthboxOtherSpriteId].oam.shape = SPRITE_SHAPE['64x64'][0];
      gSprites[healthboxOtherSpriteId].oam.tileNum += 2 * TILE_SIZE_4BPP;
    } else {
      healthboxSpriteId = CreateSprite(T().healthboxOpponent[0], 240, 160, 1);
      healthboxOtherSpriteId = CreateSpriteAtEnd(T().healthboxOpponent[0], 240, 160, 1);
      gSprites[healthboxOtherSpriteId].oam.tileNum += 1 * TILE_SIZE_4BPP;
      healthbarType = HEALTHBAR_TYPE_OPPONENT;
    }
    gSprites[healthboxSpriteId].oam.affineParam = healthboxOtherSpriteId;
    gSprites[healthboxOtherSpriteId].data[sHealthboxSpriteId] = healthboxSpriteId;
    gSprites[healthboxOtherSpriteId].callback = SpriteCB_HealthBoxOther;
  } else {
    const half = getBattlerPosition(battlerId) >> 1;
    if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) {
      healthboxSpriteId = CreateSprite(T().healthboxPlayer[half], 240, 160, 1);
      healthboxOtherSpriteId = CreateSpriteAtEnd(T().healthboxPlayer[half], 240, 160, 1);
      healthbarType = HEALTHBAR_TYPE_PLAYER_DOUBLE;
    } else {
      healthboxSpriteId = CreateSprite(T().healthboxOpponent[half], 240, 160, 1);
      healthboxOtherSpriteId = CreateSpriteAtEnd(T().healthboxOpponent[half], 240, 160, 1);
      healthbarType = HEALTHBAR_TYPE_OPPONENT;
    }
    gSprites[healthboxSpriteId].oam.affineParam = healthboxOtherSpriteId;
    gSprites[healthboxOtherSpriteId].data[sHealthboxSpriteId] = healthboxSpriteId;
    gSprites[healthboxOtherSpriteId].oam.tileNum += 1 * TILE_SIZE_4BPP;
    gSprites[healthboxOtherSpriteId].callback = SpriteCB_HealthBoxOther;
  }
  const healthbarSpriteId = CreateSpriteAtEnd(T().healthbar[g.battlerPositions[battlerId]], 140, 60, 0);
  const healthbarSprite = gSprites[healthbarSpriteId];
  SetSubspriteTables(healthbarSprite, [sHealthBar_SubspriteTable[getBattlerSide(battlerId)]]);
  healthbarSprite.subspriteMode = SUBSPRITES_IGNORE_PRIORITY;
  healthbarSprite.oam.priority = 1;
  copyToObjVram(GetBattleInterfaceGfxPtr(B_INTERFACE_GFX_HP_BAR_HP_TEXT), healthbarSprite.oam.tileNum * TILE_SIZE_4BPP, 2 * TILE_SIZE_4BPP);
  gSprites[healthboxSpriteId].data[sHealthBarSpriteId] = healthbarSpriteId;
  gSprites[healthboxSpriteId].data[sBattlerId] = battlerId;
  gSprites[healthboxSpriteId].invisible = true;
  gSprites[healthboxOtherSpriteId].invisible = true;
  healthbarSprite.data[sHealthboxSpriteId] = healthboxSpriteId;
  healthbarSprite.data[sHealthbarType] = healthbarType;
  healthbarSprite.invisible = true;
  return healthboxSpriteId;
}

/** CreateSafariPlayerHealthboxSprites */
export function CreateSafariPlayerHealthboxSprites(): number {
  const healthboxSpriteId = CreateSprite(T().healthboxSafari, 240, 160, 1);
  const healthboxOtherSpriteId = CreateSpriteAtEnd(T().healthboxSafari, 240, 160, 1);
  gSprites[healthboxSpriteId].oam.shape = SPRITE_SHAPE['64x64'][0];
  gSprites[healthboxOtherSpriteId].oam.shape = SPRITE_SHAPE['64x64'][0];
  gSprites[healthboxOtherSpriteId].oam.tileNum += 2 * TILE_SIZE_4BPP;
  gSprites[healthboxSpriteId].oam.affineParam = healthboxOtherSpriteId;
  gSprites[healthboxOtherSpriteId].data[sHealthboxSpriteId] = healthboxSpriteId;
  gSprites[healthboxOtherSpriteId].callback = SpriteCB_HealthBoxOther;
  return healthboxSpriteId;
}

/** SpriteCB_HealthBar: follows the healthbox */
function SpriteCB_HealthBar(sprite: Sprite): void {
  const box = gSprites[sprite.data[sHealthboxSpriteId]];
  switch (sprite.data[sHealthbarType]) {
    case HEALTHBAR_TYPE_PLAYER_SINGLE:
    case HEALTHBAR_TYPE_PLAYER_DOUBLE:
      sprite.x = box.x + 16;
      sprite.y = box.y;
      break;
    default:
      sprite.x = box.x + 8;
      sprite.y = box.y;
      break;
  }
  sprite.x2 = box.x2;
  sprite.y2 = box.y2;
}

function SpriteCB_HealthBoxOther(sprite: Sprite): void {
  const box = gSprites[sprite.data[sHealthboxSpriteId]];
  sprite.x = box.x + 64;
  sprite.y = box.y;
  sprite.x2 = box.x2;
  sprite.y2 = box.y2;
}

/** SetBattleBarStruct */
export function SetBattleBarStruct(battlerId: number, healthboxSpriteId: number, maxVal: number, oldVal: number, receivedValue: number): void {
  const bar = g.battleSpritesDataPtr.battleBars[battlerId];
  bar.healthboxSpriteId = healthboxSpriteId;
  bar.maxValue = maxVal;
  bar.oldValue = oldVal;
  bar.receivedValue = receivedValue;
  bar.currValue = -32768;
}

const otherId = (healthboxSpriteId: number) => gSprites[healthboxSpriteId].oam.affineParam;
const barId = (healthboxSpriteId: number) => gSprites[healthboxSpriteId].data[sHealthBarSpriteId];

export function SetHealthboxSpriteInvisible(healthboxSpriteId: number): void {
  gSprites[healthboxSpriteId].invisible = true;
  gSprites[barId(healthboxSpriteId)].invisible = true;
  gSprites[otherId(healthboxSpriteId)].invisible = true;
}

export function SetHealthboxSpriteVisible(healthboxSpriteId: number): void {
  gSprites[healthboxSpriteId].invisible = false;
  gSprites[barId(healthboxSpriteId)].invisible = false;
  gSprites[otherId(healthboxSpriteId)].invisible = false;
}

export function DestoryHealthboxSprite(healthboxSpriteId: number): void {
  DestroySprite(gSprites[otherId(healthboxSpriteId)]);
  DestroySprite(gSprites[barId(healthboxSpriteId)]);
  DestroySprite(gSprites[healthboxSpriteId]);
}

export function UpdateOamPriorityInAllHealthboxes(priority: number): void {
  for (let i = 0; i < g.battlersCount; i++) {
    const box = g.healthboxSpriteIds[i];
    gSprites[box].oam.priority = priority;
    gSprites[otherId(box)].oam.priority = priority;
    gSprites[barId(box)].oam.priority = priority;
  }
}

/** InitBattlerHealthboxCoords */
export function InitBattlerHealthboxCoords(battler: number): void {
  let x = 0;
  let y = 0;
  if (!isDoubleBattle()) {
    if (getBattlerSide(battler) !== K.B_SIDE_PLAYER) [x, y] = [44, 30];
    else [x, y] = [158, 88];
  } else {
    switch (getBattlerPosition(battler)) {
      case K.B_POSITION_PLAYER_LEFT:
        [x, y] = [159, 75];
        break;
      case K.B_POSITION_PLAYER_RIGHT:
        [x, y] = [171, 100];
        break;
      case K.B_POSITION_OPPONENT_LEFT:
        [x, y] = [44, 19];
        break;
      case K.B_POSITION_OPPONENT_RIGHT:
        [x, y] = [32, 44];
        break;
    }
  }
  gSprites[g.healthboxSpriteIds[battler]].x = x;
  gSprites[g.healthboxSpriteIds[battler]].y = y;
}

/** sHealthboxWindowTemplate + AddTextPrinterAndCreateWindowOnHealthbox */
function AddTextPrinterAndCreateWindowOnHealthbox(str: number[], x: number, y: number): { windowId: number; tileData: Uint8Array } {
  const winId = AddWindow({ bg: 0, tilemapLeft: 0, tilemapTop: 0, width: 8, height: 2, paletteNum: 0, baseBlock: 0 });
  FillWindowPixelBuffer(winId, PIXEL_FILL(2));
  AddTextPrinterParameterized4(winId, 0 /* FONT_SMALL */, x, y, 0, 0, [2, 1, 3], TEXT_SKIP_DRAW, str);
  return { windowId: winId, tileData: gWindows[winId].tileData! };
}

/** TextIntoHealthboxObject: `dest` is an OBJ VRAM byte offset */
function TextIntoHealthboxObject(dest: number, windowTileData: Uint8Array, windowWidth: number, srcOffset = 0): void {
  // + 256 prevents the top 4 blank rows of sHealthboxWindowTemplate from being copied
  vram.set(windowTileData.subarray(srcOffset + 256, srcOffset + 256 + windowWidth * TILE_SIZE_4BPP), OBJ_VRAM0 + dest + 256);
  for (let i = 0; i < windowWidth; i++) {
    const s = srcOffset + i * 32 + 20;
    vram.set(windowTileData.subarray(s, s + 12), OBJ_VRAM0 + dest + i * 32 + 20);
  }
}

/** SafariTextIntoHealthboxObject: `dest` is an OBJ VRAM byte offset */
function SafariTextIntoHealthboxObject(dest: number, windowTileData: Uint8Array, srcOffset: number, windowWidth: number): void {
  vram.set(windowTileData.subarray(srcOffset, srcOffset + windowWidth * TILE_SIZE_4BPP), OBJ_VRAM0 + dest);
  vram.set(windowTileData.subarray(srcOffset + 256, srcOffset + 256 + windowWidth * TILE_SIZE_4BPP), OBJ_VRAM0 + dest + 256);
}

/** UpdateSafariBallsTextOnHealthbox: "SAFARI BALLS" */
function UpdateSafariBallsTextOnHealthbox(healthboxSpriteId: number): void {
  const { windowId, tileData } = AddTextPrinterAndCreateWindowOnHealthbox(encodeBattleText('gText_SafariBalls'), 0, 3);
  const spriteTileNum = gSprites[healthboxSpriteId].oam.tileNum * TILE_SIZE_4BPP;
  TextIntoHealthboxObject(0x40 + spriteTileNum, tileData, 6);
  TextIntoHealthboxObject(0x800 + spriteTileNum, tileData, 2, 0xc0);
  RemoveWindow(windowId);
}

/** UpdateLeftNoOfBallsTextOnHealthbox: "Left: N", right-aligned to x 47 */
function UpdateLeftNoOfBallsTextOnHealthbox(healthboxSpriteId: number): void {
  const left = encodeBattleText('gText_HighlightRed_Left');
  const text = [...left.slice(0, left.indexOf(K.EOS)), ...ConvertIntToDecimalStringN(g.numSafariBalls, STR_CONV_MODE_LEFT_ALIGN, 2), K.EOS];
  const { windowId, tileData } = AddTextPrinterAndCreateWindowOnHealthbox(text, 47 - GetStringWidth(0 /* FONT_SMALL */, text, 0), 3);
  const spriteTileNum = gSprites[healthboxSpriteId].oam.tileNum * TILE_SIZE_4BPP;
  SafariTextIntoHealthboxObject(0x2c0 + spriteTileNum, tileData, 0, 2);
  SafariTextIntoHealthboxObject(0xa00 + spriteTileNum, tileData, 0x40, 4);
  RemoveWindow(windowId);
}

/** UpdateLvlInHealthbox */
function UpdateLvlInHealthbox(healthboxSpriteId: number, lvl: number): void {
  const digits = ConvertIntToDecimalStringN(lvl, STR_CONV_MODE_LEFT_ALIGN, 3);
  const text = [...charmap.encodePlain('{LV_2}'), ...digits, K.EOS];
  const xPos = 5 * (3 - digits.length);
  const { windowId, tileData } = AddTextPrinterAndCreateWindowOnHealthbox(text, xPos, 3);
  const spriteTileNum = gSprites[healthboxSpriteId].oam.tileNum * TILE_SIZE_4BPP;
  let objVram: number;
  if (getBattlerSide(gSprites[healthboxSpriteId].data[sBattlerId]) === K.B_SIDE_PLAYER) objVram = spriteTileNum + (isDoubleBattle() ? 0x420 : 0x820);
  else objVram = spriteTileNum + 0x400;
  TextIntoHealthboxObject(objVram, tileData, 3);
  RemoveWindow(windowId);
}

/** UpdateHpTextInHealthbox */
export function UpdateHpTextInHealthbox(healthboxSpriteId: number, value: number, maxOrCurrent: number): void {
  const battler = gSprites[healthboxSpriteId].data[sBattlerId];
  if (getBattlerSide(battler) === K.B_SIDE_PLAYER && !isDoubleBattle()) {
    const spriteTileNum = gSprites[healthboxSpriteId].oam.tileNum;
    if (maxOrCurrent !== K.HP_CURRENT) {
      // singles, max
      const text = [...ConvertIntToDecimalStringN(value, STR_CONV_MODE_RIGHT_ALIGN, 3), K.EOS];
      const { windowId, tileData } = AddTextPrinterAndCreateWindowOnHealthbox(text, 0, 5);
      TextIntoHealthboxObject(spriteTileNum * TILE_SIZE_4BPP + 0xa40, tileData, 2);
      RemoveWindow(windowId);
    } else {
      // singles, current
      const text = [...ConvertIntToDecimalStringN(value, STR_CONV_MODE_RIGHT_ALIGN, 3), K.CHAR_SLASH, K.EOS];
      const { windowId, tileData } = AddTextPrinterAndCreateWindowOnHealthbox(text, 4, 5);
      TextIntoHealthboxObject(spriteTileNum * TILE_SIZE_4BPP + 0x2e0, tileData, 1);
      TextIntoHealthboxObject(spriteTileNum * TILE_SIZE_4BPP + 0xa00, tileData, 2, 0x20);
      RemoveWindow(windowId);
    }
  } else if (isDoubleBattle() || getBattlerSide(battler) === K.B_SIDE_OPPONENT) {
    UpdateHpTextInHealthboxInDoubles(healthboxSpriteId, value, maxOrCurrent);
  }
  // else: Japanese-only HP text in singles (unreachable in English)
}

/** UpdateHpTextInHealthboxInDoubles: only draws when the HP numbers replace the bar. */
function UpdateHpTextInHealthboxInDoubles(healthboxSpriteId: number, _value: number, _maxOrCurrent: number): void {
  const battlerId = gSprites[healthboxSpriteId].data[sBattlerId];
  if (g.battleSpritesDataPtr.battlerData[battlerId].hpNumbersNoBars) {
    console.warn('[battle] HP numbers in place of bars (RenderTextHandleBold) not implemented');
  }
}

/** SwapHpBarsWithHpText (START during action selection): only affects doubles in English. */
export function SwapHpBarsWithHpText(): void {
  for (let i = 0; i < g.battlersCount; i++) {
    if (
      gSprites[g.healthboxSpriteIds[i]].callback === SpriteCallbackDummy &&
      getBattlerSide(i) !== K.B_SIDE_OPPONENT &&
      (isDoubleBattle() || getBattlerSide(i) !== K.B_SIDE_PLAYER)
    ) {
      console.warn('[battle] SwapHpBarsWithHpText in doubles not implemented');
    }
  }
}

// ---------------------------------------------------------------- party status summary

const tBattler = 0;
const tSummaryBarSpriteId = 1;
const tBallIconSpriteId = (n: number) => 3 + n;
const tIsBattleStart = 10;
const tTimer = 11;
const tBlendWeight = 15;
const sEnterSpeed = 0;
const sExitSpeed = 1;
const sSummaryBarSpriteId = 0;
const sTimer = 1;
const sIsOpponent = 2;
const sSpeed = 3;
const sIsEmptyBall = 7;

/** CreatePartyStatusSummarySprites */
export function CreatePartyStatusSummarySprites(battlerId: number, partyInfo: HpAndStatus[], isSwitchingMons: boolean, isBattleStart: boolean): number {
  let isOpponent: boolean;
  let x: number, y: number, x2: number, speed: number;
  if (!isSwitchingMons || getBattlerPosition(battlerId) !== K.B_POSITION_OPPONENT_RIGHT) {
    if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) {
      isOpponent = false;
      [x, y, x2, speed] = [136, 96, 100, -5];
    } else {
      isOpponent = true;
      if (!isSwitchingMons || !isDoubleBattle()) [x, y] = [104, 40];
      else [x, y] = [104, 16];
      [x2, speed] = [-100, 5];
    }
  } else {
    isOpponent = true;
    [x, y, x2, speed] = [104, 40, -100, 5];
  }
  let nValidMons = 0;
  for (let i = 0; i < K.PARTY_SIZE; i++) if (partyInfo[i].hp !== K.HP_EMPTY_SLOT) nValidMons++;
  const o = +isOpponent;
  const barTags = [K.TAG_PARTY_SUMMARY_BAR_PLAYER_TILE, K.TAG_PARTY_SUMMARY_BAR_OPPONENT_TILE];
  const ballTags = [K.TAG_PARTY_SUMMARY_BALL_PLAYER_TILE, K.TAG_PARTY_SUMMARY_BALL_OPPONENT_TILE];
  LoadCompressedSpriteSheet({ data: gfx('gBattleInterface_PartySummaryBar_Gfx'), size: 16 * TILE_SIZE_4BPP, tag: barTags[o] });
  LoadSpriteSheet({ data: GetBattleInterfaceGfxPtr(B_INTERFACE_GFX_BALL_PARTY_SUMMARY), size: 4 * TILE_SIZE_4BPP, tag: ballTags[o] });
  LoadSpritePalette({ data: gfx16('gBattleInterface_Healthbox_Pal'), tag: [K.TAG_PARTY_SUMMARY_BAR_PLAYER_PAL, K.TAG_PARTY_SUMMARY_BAR_OPPONENT_PAL][o] });
  LoadSpritePalette({ data: gfx16('gBattleInterface_Healthbar_Pal'), tag: [K.TAG_PARTY_SUMMARY_BALL_PLAYER_PAL, K.TAG_PARTY_SUMMARY_BALL_OPPONENT_PAL][o] });
  const summaryBarSpriteId = CreateSprite(T().partySummaryBar[o], x, y, 10);
  SetSubspriteTables(gSprites[summaryBarSpriteId], sStatusSummaryBar_SubspriteTable_Enter);
  gSprites[summaryBarSpriteId].x2 = x2;
  gSprites[summaryBarSpriteId].data[sEnterSpeed] = speed;
  if (isOpponent) {
    gSprites[summaryBarSpriteId].x -= 96;
    gSprites[summaryBarSpriteId].oam.matrixNum = K.ST_OAM_HFLIP;
  } else {
    gSprites[summaryBarSpriteId].x += 96;
  }
  const ballIconSpritesIds: number[] = [];
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const id = (ballIconSpritesIds[i] = CreateSpriteAtEnd(T().partySummaryBall[o], x, y - 4, 9));
    const s = gSprites[id];
    if (!isBattleStart) s.callback = SpriteCB_PartySummaryBall_OnSwitchout;
    if (!isOpponent) {
      s.x2 = 0;
      s.y2 = 0;
    }
    s.data[sSummaryBarSpriteId] = summaryBarSpriteId;
    if (!isOpponent) {
      s.x += 10 * i + 24;
      s.data[sTimer] = i * 7 + 10;
      s.x2 = 120;
    } else {
      s.x -= 10 * (5 - i) + 24;
      s.data[sTimer] = (6 - i) * 7 + 10;
      s.x2 = -120;
    }
    s.data[sIsOpponent] = o;
  }
  const multi = (g.battleTypeFlags & K.BATTLE_TYPE_MULTI) !== 0;
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const s = gSprites[ballIconSpritesIds[getBattlerSide(battlerId) === K.B_SIDE_PLAYER ? i : 5 - i]];
    const empty = multi ? partyInfo[i].hp === K.HP_EMPTY_SLOT : i >= nValidMons;
    if (empty) {
      s.oam.tileNum += 1;
      s.data[sIsEmptyBall] = 1;
    } else if (partyInfo[i].hp === 0) {
      s.oam.tileNum += 3;
    } else if (partyInfo[i].status !== 0) {
      s.oam.tileNum += 2;
    }
  }
  const taskId = CreateTask(TaskDummy, 5);
  const d = gTasks[taskId].data;
  d[tBattler] = battlerId;
  d[tSummaryBarSpriteId] = summaryBarSpriteId;
  for (let i = 0; i < K.PARTY_SIZE; i++) d[tBallIconSpriteId(i)] = ballIconSpritesIds[i];
  d[tIsBattleStart] = +isBattleStart;
  PlaySE12WithPanning(K.SE_BALL_TRAY_ENTER, 0);
  return taskId;
}

/** Task_HidePartyStatusSummary */
export const Task_HidePartyStatusSummary: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const isBattleStart = d[tIsBattleStart];
  const summaryBarSpriteId = d[tSummaryBarSpriteId];
  const battlerId = d[tBattler];
  const ballIconSpriteIds = [0, 1, 2, 3, 4, 5].map((i) => d[tBallIconSpriteId(i)]);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 0));
  d[tBlendWeight] = 16;
  for (let i = 0; i < K.PARTY_SIZE; i++) gSprites[ballIconSpriteIds[i]].oam.objMode = 1; // ST_OAM_OBJ_BLEND
  gSprites[summaryBarSpriteId].oam.objMode = 1;
  if (isBattleStart) {
    for (let i = 0; i < K.PARTY_SIZE; i++) {
      const s = gSprites[ballIconSpriteIds[getBattlerSide(battlerId) !== K.B_SIDE_PLAYER ? 5 - i : i]];
      s.data[sTimer] = 7 * i;
      s.data[sSpeed] = 0;
      s.data[4] = 0;
      s.callback = SpriteCB_PartySummaryBall_Exit;
    }
    gSprites[summaryBarSpriteId].data[sEnterSpeed] = Math.trunc(gSprites[summaryBarSpriteId].data[sEnterSpeed] / 2);
    gSprites[summaryBarSpriteId].data[sExitSpeed] = 0;
    gSprites[summaryBarSpriteId].callback = SpriteCB_PartySummaryBar_Exit;
    SetSubspriteTables(gSprites[summaryBarSpriteId], sStatusSummaryBar_SubspriteTable_Exit);
    gTasks[taskId].func = Task_HidePartyStatusSummary_BattleStart_1;
  } else {
    gTasks[taskId].func = Task_HidePartyStatusSummary_DuringBattle;
  }
};

const Task_HidePartyStatusSummary_BattleStart_1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[tTimer]++ % 2 === 0) {
    if (--d[tBlendWeight] < 0) return;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[tBlendWeight], 16 - d[tBlendWeight]));
  }
  if (d[tBlendWeight] === 0) gTasks[taskId].func = Task_HidePartyStatusSummary_BattleStart_2;
};

function destroySummarySprites(d: Int16Array): void {
  DestroySpriteAndFreeResources(gSprites[d[tSummaryBarSpriteId]]);
  DestroySpriteAndFreeResources(gSprites[d[tBallIconSpriteId(0)]]);
  for (let i = 1; i < K.PARTY_SIZE; i++) DestroySprite(gSprites[d[tBallIconSpriteId(i)]]);
}

const Task_HidePartyStatusSummary_BattleStart_2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (--d[tBlendWeight] === -1) {
    destroySummarySprites(d);
  } else if (d[tBlendWeight] === -3) {
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, 0);
    DestroyTask(taskId);
  }
};

const Task_HidePartyStatusSummary_DuringBattle: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (--d[tBlendWeight] >= 0) {
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[tBlendWeight], 16 - d[tBlendWeight]));
  } else if (d[tBlendWeight] === -1) {
    destroySummarySprites(d);
  } else if (d[tBlendWeight] === -3) {
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, 0);
    DestroyTask(taskId);
  }
};

function SpriteCB_PartySummaryBar(sprite: Sprite): void {
  if (sprite.x2 !== 0) sprite.x2 += sprite.data[sEnterSpeed];
}

function SpriteCB_PartySummaryBar_Exit(sprite: Sprite): void {
  sprite.data[sExitSpeed] += 32;
  if (sprite.data[sEnterSpeed] > 0) sprite.x2 += sprite.data[sExitSpeed] >> 4;
  else sprite.x2 -= sprite.data[sExitSpeed] >> 4;
  sprite.data[sExitSpeed] &= 0xf;
}

function SpriteCB_PartySummaryBall_OnBattleStart(sprite: Sprite): void {
  if (sprite.data[sTimer] > 0) {
    sprite.data[sTimer]--;
    return;
  }
  const isOpponent = sprite.data[sIsOpponent];
  const speed = ((sprite.data[sSpeed] & 0xffff) + 56) & 0xffff;
  sprite.data[sSpeed] = speed & 0xfff0;
  if (isOpponent) {
    sprite.x2 += speed >> 4;
    if (sprite.x2 > 0) sprite.x2 = 0;
  } else {
    sprite.x2 -= speed >> 4;
    if (sprite.x2 < 0) sprite.x2 = 0;
  }
  if (sprite.x2 === 0) {
    const pan = isOpponent ? K.SOUND_PAN_ATTACKER : K.SOUND_PAN_TARGET;
    if (sprite.data[sIsEmptyBall]) PlaySE2WithPanning(K.SE_BALL_TRAY_EXIT, pan);
    else PlaySE1WithPanning(K.SE_BALL_TRAY_BALL, pan);
    sprite.callback = SpriteCallbackDummy;
  }
}

function SpriteCB_PartySummaryBall_Exit(sprite: Sprite): void {
  if (sprite.data[sTimer] > 0) {
    sprite.data[sTimer]--;
    return;
  }
  const isOpponent = sprite.data[sIsOpponent];
  const speed = ((sprite.data[sSpeed] & 0xffff) + 56) & 0xffff;
  sprite.data[sSpeed] = speed & 0xfff0;
  if (isOpponent) sprite.x2 += speed >> 4;
  else sprite.x2 -= speed >> 4;
  if (sprite.x2 + sprite.x > DISPLAY_WIDTH + 8 || sprite.x2 + sprite.x < -8) {
    sprite.invisible = true;
    sprite.callback = SpriteCallbackDummy;
  }
}

function SpriteCB_PartySummaryBall_OnSwitchout(sprite: Sprite): void {
  const bar = gSprites[sprite.data[sSummaryBarSpriteId]];
  sprite.x2 = bar.x2;
  sprite.y2 = bar.y2;
}

// ---------------------------------------------------------------- nickname, status, bars

/** CheckBattleTypeGhost (pokemon.c) */
export function CheckBattleTypeGhost(mon: Pokemon, battlerId: number): boolean {
  if (g.battleTypeFlags & K.BATTLE_TYPE_GHOST && getBattlerSide(battlerId) !== K.B_SIDE_PLAYER) {
    const ghost = encodeBattleText('gText_Ghost');
    const nick = mon.nickname;
    return nick.length === ghost.length - 1 && nick.every((c, i) => c === ghost[i]);
  }
  return false;
}

/** UpdateNickInHealthbox */
export function UpdateNickInHealthbox(healthboxSpriteId: number, mon: Pokemon): void {
  const str: number[] = [...charmap.encodePlain('{HIGHLIGHT 02}'), ...mon.nickname, K.EXT_CTRL_CODE_BEGIN, K.EXT_CTRL_CODE_COLOR];
  let gender = pokemon.gender(mon);
  const species = mon.species;
  const speciesName = pokemon.speciesName(species);
  if (
    (species === K.SPECIES_NIDORAN_F || species === K.SPECIES_NIDORAN_M) &&
    mon.nickname.length === speciesName.length &&
    mon.nickname.every((c, i) => c === speciesName[i])
  )
    gender = 100;
  if (CheckBattleTypeGhost(mon, gSprites[healthboxSpriteId].data[sBattlerId])) gender = 100;
  if (gender === K.MON_MALE) str.push(K.TEXT_DYNAMIC_COLOR_2, K.CHAR_MALE, K.EOS);
  else if (gender === K.MON_FEMALE) str.push(K.TEXT_DYNAMIC_COLOR_1, K.CHAR_FEMALE, K.EOS);
  else str.push(K.TEXT_DYNAMIC_COLOR_2, K.EOS);
  g.displayedStringBattle = str;
  const { windowId, tileData } = AddTextPrinterAndCreateWindowOnHealthbox(str, 0, 3);
  const spriteTileNum = gSprites[healthboxSpriteId].oam.tileNum * TILE_SIZE_4BPP;
  if (getBattlerSide(gSprites[healthboxSpriteId].data[sBattlerId]) === K.B_SIDE_PLAYER) {
    TextIntoHealthboxObject(0x40 + spriteTileNum, tileData, 6);
    TextIntoHealthboxObject(spriteTileNum + (isDoubleBattle() ? 0x400 : 0x800), tileData, 1, 0xc0);
  } else {
    TextIntoHealthboxObject(0x20 + spriteTileNum, tileData, 7);
  }
  RemoveWindow(windowId);
}

/** TryAddPokeballIconToHealthbox */
export function TryAddPokeballIconToHealthbox(healthboxSpriteId: number, noStatus: boolean): void {
  if (g.battleTypeFlags & (K.BATTLE_TYPE_FIRST_BATTLE | K.BATTLE_TYPE_OLD_MAN_TUTORIAL | K.BATTLE_TYPE_POKEDUDE)) return;
  if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER) return;
  const battlerId = gSprites[healthboxSpriteId].data[sBattlerId];
  if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) return;
  const mon = g.enemyParty[g.battlerPartyIndexes[battlerId]]!;
  if (CheckBattleTypeGhost(mon, battlerId)) return;
  if (!state.dexCaught.has(pokemon.nationalDex(mon.species))) return; // GetSetPokedexFlag(FLAG_GET_CAUGHT)
  const healthBarSpriteId = barId(healthboxSpriteId);
  const dest = (gSprites[healthBarSpriteId].oam.tileNum + 8) * TILE_SIZE_4BPP;
  if (noStatus) copyToObjVram(GetBattleInterfaceGfxPtr(B_INTERFACE_GFX_BALL_CAUGHT), dest, TILE_SIZE_4BPP);
  else fillObjVram(dest, TILE_SIZE_4BPP);
}

/** sStatusIconColors */
const sStatusIconColors = [RGB(24, 12, 24), RGB(23, 23, 3), RGB(20, 20, 17), RGB(17, 22, 28), RGB(28, 14, 10)];
const PAL_STATUS_PSN = 0, PAL_STATUS_PAR = 1, PAL_STATUS_SLP = 2, PAL_STATUS_FRZ = 3, PAL_STATUS_BRN = 4;

/** GetStatusIconForBattlerId */
function GetStatusIconForBattlerId(statusElementId: number, battlerId: number): number {
  const table: Record<number, number[]> = {
    [B_INTERFACE_GFX_STATUS_PSN_BATTLER0]: [B_INTERFACE_GFX_STATUS_PSN_BATTLER0, B_INTERFACE_GFX_STATUS_PSN_BATTLER1, B_INTERFACE_GFX_STATUS_PSN_BATTLER2, B_INTERFACE_GFX_STATUS_PSN_BATTLER3],
    [B_INTERFACE_GFX_STATUS_PAR_BATTLER0]: [B_INTERFACE_GFX_STATUS_PAR_BATTLER0, B_INTERFACE_GFX_STATUS_PAR_BATTLER1, B_INTERFACE_GFX_STATUS_PAR_BATTLER2, B_INTERFACE_GFX_STATUS_PAR_BATTLER3],
    [B_INTERFACE_GFX_STATUS_SLP_BATTLER0]: [B_INTERFACE_GFX_STATUS_SLP_BATTLER0, B_INTERFACE_GFX_STATUS_SLP_BATTLER1, B_INTERFACE_GFX_STATUS_SLP_BATTLER2, B_INTERFACE_GFX_STATUS_SLP_BATTLER3],
    [B_INTERFACE_GFX_STATUS_FRZ_BATTLER0]: [B_INTERFACE_GFX_STATUS_FRZ_BATTLER0, B_INTERFACE_GFX_STATUS_FRZ_BATTLER1, B_INTERFACE_GFX_STATUS_FRZ_BATTLER2, B_INTERFACE_GFX_STATUS_FRZ_BATTLER3],
    [B_INTERFACE_GFX_STATUS_BRN_BATTLER0]: [B_INTERFACE_GFX_STATUS_BRN_BATTLER0, B_INTERFACE_GFX_STATUS_BRN_BATTLER1, B_INTERFACE_GFX_STATUS_BRN_BATTLER2, B_INTERFACE_GFX_STATUS_BRN_BATTLER3],
  };
  return table[statusElementId]?.[Math.min(battlerId, 3)] ?? statusElementId;
}

/** UpdateStatusIconInHealthbox */
function UpdateStatusIconInHealthbox(healthboxSpriteId: number): void {
  const battlerId = gSprites[healthboxSpriteId].data[sBattlerId];
  const healthBarSpriteId = barId(healthboxSpriteId);
  let status: number;
  let tileNumAdder: number;
  if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) {
    status = g.playerParty[g.battlerPartyIndexes[battlerId]]!.status;
    tileNumAdder = isDoubleBattle() ? 0x12 : 0x1a;
  } else {
    status = g.enemyParty[g.battlerPartyIndexes[battlerId]]!.status;
    tileNumAdder = 0x11;
  }
  let element: number;
  let statusPalId: number;
  if (status & K.STATUS1_SLEEP) [element, statusPalId] = [B_INTERFACE_GFX_STATUS_SLP_BATTLER0, PAL_STATUS_SLP];
  else if (status & K.STATUS1_PSN_ANY) [element, statusPalId] = [B_INTERFACE_GFX_STATUS_PSN_BATTLER0, PAL_STATUS_PSN];
  else if (status & K.STATUS1_BURN) [element, statusPalId] = [B_INTERFACE_GFX_STATUS_BRN_BATTLER0, PAL_STATUS_BRN];
  else if (status & K.STATUS1_FREEZE) [element, statusPalId] = [B_INTERFACE_GFX_STATUS_FRZ_BATTLER0, PAL_STATUS_FRZ];
  else if (status & K.STATUS1_PARALYSIS) [element, statusPalId] = [B_INTERFACE_GFX_STATUS_PAR_BATTLER0, PAL_STATUS_PAR];
  else {
    const none = GetBattleInterfaceGfxPtr(B_INTERFACE_GFX_STATUS_NONE);
    for (let i = 0; i < 3; i++) copyToObjVram(none, (gSprites[healthboxSpriteId].oam.tileNum + tileNumAdder + i) * TILE_SIZE_4BPP, TILE_SIZE_4BPP);
    if (!g.battleSpritesDataPtr.battlerData[battlerId].hpNumbersNoBars)
      copyToObjVram(GetBattleInterfaceGfxPtr(B_INTERFACE_GFX_HP_BAR_HP_TEXT), gSprites[healthBarSpriteId].oam.tileNum * TILE_SIZE_4BPP, 2 * TILE_SIZE_4BPP);
    TryAddPokeballIconToHealthbox(healthboxSpriteId, true);
    return;
  }
  const statusGfxPtr = GetBattleInterfaceGfxPtr(GetStatusIconForBattlerId(element, battlerId));
  const pltAdder = PLTT_ID(gSprites[healthboxSpriteId].oam.paletteNum) + battlerId + 12;
  FillPalette(sStatusIconColors[statusPalId], pltAdder + OBJ_PLTT_OFFSET, 2);
  pltt[OBJ_PLTT_OFFSET + pltAdder] = gPlttBufferUnfaded[OBJ_PLTT_OFFSET + pltAdder];
  copyToObjVram(statusGfxPtr, (gSprites[healthboxSpriteId].oam.tileNum + tileNumAdder) * TILE_SIZE_4BPP, 3 * TILE_SIZE_4BPP);
  if (isDoubleBattle() || getBattlerSide(battlerId) === K.B_SIDE_OPPONENT) {
    if (!g.battleSpritesDataPtr.battlerData[battlerId].hpNumbersNoBars) {
      copyToObjVram(GetBattleInterfaceGfxPtr(B_INTERFACE_GFX_TRANSPARENT), gSprites[healthBarSpriteId].oam.tileNum * TILE_SIZE_4BPP, TILE_SIZE_4BPP);
      copyToObjVram(GetBattleInterfaceGfxPtr(B_INTERFACE_GFX_HP_BAR_LEFT_BORDER), (gSprites[healthBarSpriteId].oam.tileNum + 1) * TILE_SIZE_4BPP, TILE_SIZE_4BPP);
    }
  }
  TryAddPokeballIconToHealthbox(healthboxSpriteId, false);
}

/** UpdateHealthboxAttribute */
export function UpdateHealthboxAttribute(healthboxSpriteId: number, mon: Pokemon, elementId: number): void {
  const battlerId = gSprites[healthboxSpriteId].data[sBattlerId];
  const all = elementId === K.HEALTHBOX_ALL;
  if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) {
    if (elementId === K.HEALTHBOX_LEVEL || all) UpdateLvlInHealthbox(healthboxSpriteId, mon.level);
    if (elementId === K.HEALTHBOX_CURRENT_HP || all) UpdateHpTextInHealthbox(healthboxSpriteId, mon.hp, K.HP_CURRENT);
    if (elementId === K.HEALTHBOX_MAX_HP || all) UpdateHpTextInHealthbox(healthboxSpriteId, mon.maxHP, K.HP_MAX);
    if (elementId === K.HEALTHBOX_HEALTH_BAR || all) {
      SetBattleBarStruct(battlerId, healthboxSpriteId, mon.maxHP, mon.hp, 0);
      MoveBattleBar(battlerId, healthboxSpriteId, K.HEALTH_BAR, 0);
    }
    const isDoubles = isDoubleBattle();
    if (!isDoubles && (elementId === K.HEALTHBOX_EXP_BAR || all)) {
      const growth = gSpeciesInfo[mon.species].growthRate;
      const table = pokemon.tables.experience[growth];
      const currLevelExp = table[mon.level];
      SetBattleBarStruct(battlerId, healthboxSpriteId, table[mon.level + 1] - currLevelExp, mon.exp - currLevelExp, +isDoubles);
      MoveBattleBar(battlerId, healthboxSpriteId, K.EXP_BAR, 0);
    }
    if (elementId === K.HEALTHBOX_NICK || all) UpdateNickInHealthbox(healthboxSpriteId, mon);
    if (elementId === K.HEALTHBOX_STATUS_ICON || all) UpdateStatusIconInHealthbox(healthboxSpriteId);
    if (elementId === K.HEALTHBOX_SAFARI_ALL_TEXT) UpdateSafariBallsTextOnHealthbox(healthboxSpriteId);
    if (elementId === K.HEALTHBOX_SAFARI_ALL_TEXT || elementId === K.HEALTHBOX_SAFARI_BALLS_TEXT) UpdateLeftNoOfBallsTextOnHealthbox(healthboxSpriteId);
  } else {
    if (elementId === K.HEALTHBOX_LEVEL || all) UpdateLvlInHealthbox(healthboxSpriteId, mon.level);
    if (elementId === K.HEALTHBOX_HEALTH_BAR || all) {
      SetBattleBarStruct(battlerId, healthboxSpriteId, mon.maxHP, mon.hp, 0);
      MoveBattleBar(battlerId, healthboxSpriteId, K.HEALTH_BAR, 0);
    }
    if (elementId === K.HEALTHBOX_NICK || all) UpdateNickInHealthbox(healthboxSpriteId, mon);
    if (elementId === K.HEALTHBOX_STATUS_ICON || all) UpdateStatusIconInHealthbox(healthboxSpriteId);
  }
}

/** MoveBattleBar: returns the new value, or -1 when the bar has finished moving. */
export function MoveBattleBar(battlerId: number, _healthboxSpriteId: number, whichBar: number, _unused: number): number {
  const bar = g.battleSpritesDataPtr.battleBars[battlerId];
  let currentBarValue: number;
  if (whichBar === K.HEALTH_BAR) {
    currentBarValue = CalcNewBarValue(bar, B_HEALTHBAR_NUM_TILES, 1);
  } else {
    let increment = GetReceivedValueInPixels(bar.oldValue, bar.receivedValue, bar.maxValue, B_EXPBAR_NUM_TILES) & 0xffff;
    if (increment === 0) increment = 1;
    increment = Math.abs(Math.trunc(bar.receivedValue / increment)) & 0xffff;
    currentBarValue = CalcNewBarValue(bar, B_EXPBAR_NUM_TILES, increment);
  }
  if (whichBar === K.EXP_BAR || (whichBar === K.HEALTH_BAR && !g.battleSpritesDataPtr.battlerData[battlerId].hpNumbersNoBars)) MoveBattleBarGraphically(battlerId, whichBar);
  if (currentBarValue === -1) bar.currValue = 0;
  return currentBarValue;
}

function MoveBattleBarGraphically(battlerId: number, whichBar: number): void {
  const bar = g.battleSpritesDataPtr.battleBars[battlerId];
  const filledPixels = new Uint8Array(8);
  if (whichBar === K.HEALTH_BAR) {
    const totalFilledPixels = CalcBarFilledPixels(bar, filledPixels, B_HEALTHBAR_NUM_TILES);
    let barElementId: number;
    if (totalFilledPixels > (B_HEALTHBAR_NUM_PIXELS * 50) / 100) barElementId = B_INTERFACE_GFX_HP_BAR_GREEN;
    else if (totalFilledPixels > Math.trunc((B_HEALTHBAR_NUM_PIXELS * 20) / 100)) barElementId = B_INTERFACE_GFX_HP_BAR_YELLOW;
    else barElementId = B_INTERFACE_GFX_HP_BAR_RED;
    const healthbarSpriteId = barId(bar.healthboxSpriteId);
    for (let i = 0; i < B_HEALTHBAR_NUM_TILES; i++) {
      const src = GetBattleInterfaceGfxPtr(barElementId).subarray(filledPixels[i] * TILE_SIZE_4BPP);
      if (i < 2) copyToObjVram(src, (gSprites[healthbarSpriteId].oam.tileNum + 2 + i) * TILE_SIZE_4BPP, TILE_SIZE_4BPP);
      else copyToObjVram(src, 64 + (i + gSprites[healthbarSpriteId].oam.tileNum) * TILE_SIZE_4BPP, TILE_SIZE_4BPP);
    }
  } else {
    CalcBarFilledPixels(bar, filledPixels, B_EXPBAR_NUM_TILES);
    if (g.playerParty[g.battlerPartyIndexes[battlerId]]!.level === K.MAX_LEVEL) filledPixels.fill(0);
    const boxTile = gSprites[bar.healthboxSpriteId].oam.tileNum;
    for (let i = 0; i < B_EXPBAR_NUM_TILES; i++) {
      const src = GetBattleInterfaceGfxPtr(B_INTERFACE_GFX_EXP_BAR).subarray(filledPixels[i] * TILE_SIZE_4BPP);
      if (i < 4) copyToObjVram(src, (boxTile + 36 + i) * TILE_SIZE_4BPP, TILE_SIZE_4BPP);
      else copyToObjVram(src, 0xb80 + (i + boxTile) * TILE_SIZE_4BPP, TILE_SIZE_4BPP);
    }
  }
}

interface Bar {
  maxValue: number;
  oldValue: number;
  receivedValue: number;
  currValue: number;
}

const Q_24_8 = (n: number) => n << 8;
const Q_24_8_TO_INT = (n: number) => n >> 8;

/** CalcNewBarValue (bar.currValue is updated in place) */
function CalcNewBarValue(bar: Bar, totalPixels: number, increment: number): number {
  const { maxValue, oldValue, receivedValue } = bar;
  totalPixels *= 8;
  if (bar.currValue === -32768) bar.currValue = maxValue < totalPixels ? Q_24_8(oldValue) : oldValue; // first function call
  let newValue = oldValue - receivedValue;
  if (newValue < 0) newValue = 0;
  else if (newValue > maxValue) newValue = maxValue;
  if (maxValue < totalPixels) {
    if (newValue === Q_24_8_TO_INT(bar.currValue) && (bar.currValue & 0xff) === 0) return -1;
  } else if (newValue === bar.currValue) {
    return -1; // we're done, the bar's value has been updated
  }
  let ret: number;
  if (maxValue < totalPixels) {
    // handle cases of max var having less pixels than the whole bar
    const incrementInQ = Math.trunc(Q_24_8(maxValue) / totalPixels);
    if (receivedValue < 0) {
      // fill bar right
      bar.currValue += incrementInQ;
      ret = Q_24_8_TO_INT(bar.currValue);
      if (ret >= newValue) {
        bar.currValue = Q_24_8(newValue);
        ret = newValue;
      }
    } else {
      // move bar left
      bar.currValue -= incrementInQ;
      ret = Q_24_8_TO_INT(bar.currValue);
      if ((bar.currValue & 0xff) > 0) ret++; // try round up
      if (ret <= newValue) {
        bar.currValue = Q_24_8(newValue);
        ret = newValue;
      }
    }
  } else if (receivedValue < 0) {
    bar.currValue += increment;
    if (bar.currValue > newValue) bar.currValue = newValue;
    ret = bar.currValue;
  } else {
    bar.currValue -= increment;
    if (bar.currValue < newValue) bar.currValue = newValue;
    ret = bar.currValue;
  }
  return ret;
}

/** CalcBarFilledPixels */
function CalcBarFilledPixels(bar: Bar, filledPixels: Uint8Array, numTiles: number): number {
  const { maxValue, oldValue, receivedValue } = bar;
  let newValue = oldValue - receivedValue;
  if (newValue < 0) newValue = 0;
  else if (newValue > maxValue) newValue = maxValue;
  const totalPixels = numTiles * 8;
  filledPixels.fill(0, 0, numTiles);
  let numPixelsToFill: number;
  if (maxValue < totalPixels) numPixelsToFill = Q_24_8_TO_INT(Math.trunc((bar.currValue * totalPixels) / maxValue)) & 0xff;
  else numPixelsToFill = Math.trunc((bar.currValue * totalPixels) / maxValue) & 0xff;
  let totalFilledPixels = numPixelsToFill;
  if (numPixelsToFill === 0 && newValue > 0) {
    filledPixels[0] = 1;
    totalFilledPixels = 1;
  } else {
    for (let i = 0; i < numTiles; i++) {
      if (numPixelsToFill >= 8) {
        filledPixels[i] = 8;
      } else {
        filledPixels[i] = numPixelsToFill;
        break;
      }
      numPixelsToFill -= 8;
    }
  }
  return totalFilledPixels;
}

function GetReceivedValueInPixels(oldValue: number, receivedValue: number, maxValue: number, totalPixels: number): number {
  totalPixels *= 8;
  let newVal = oldValue - receivedValue;
  if (newVal < 0) newVal = 0;
  else if (newVal > maxValue) newVal = maxValue;
  const oldToMax = (Math.trunc((oldValue * totalPixels) / maxValue) << 24) >> 24;
  const newToMax = (Math.trunc((newVal * totalPixels) / maxValue) << 24) >> 24;
  return Math.abs(oldToMax - newToMax) & 0xff;
}

/** GetScaledHPFraction */
export function GetScaledHPFraction(hp: number, maxhp: number, scale: number): number {
  const result = Math.trunc((hp * scale) / maxhp) & 0xff;
  if (result === 0 && hp > 0) return 1;
  return result;
}

/** GetHPBarLevel */
export function GetHPBarLevel(hp: number, maxhp: number): number {
  if (hp === maxhp) return K.HP_BAR_FULL;
  const fraction = GetScaledHPFraction(hp, maxhp, B_HEALTHBAR_NUM_PIXELS);
  if (fraction > (B_HEALTHBAR_NUM_PIXELS * 50) / 100) return K.HP_BAR_GREEN;
  if (fraction > Math.trunc((B_HEALTHBAR_NUM_PIXELS * 20) / 100)) return K.HP_BAR_YELLOW;
  if (fraction > 0) return K.HP_BAR_RED;
  return K.HP_BAR_EMPTY;
}

export { B_INTERFACE_GFX_BOTTOM_RIGHT_CORNER_HP_AS_TEXT };
