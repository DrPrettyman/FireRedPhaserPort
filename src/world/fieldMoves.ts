// The field side of the field moves: fldeff_cut.c, fldeff_rocksmash.c (incl. CreateFieldEffectShowMon),
// fldeff_sweetscent.c, fldeff_dig.c, fldeff_teleport.c, and the field_effect.c tasks they end in (Teleport's
// warp, the Escape Rope warp that Dig uses). The party menu's half (CursorCB_FieldMove,
// FieldCallback_PrepareFadeInFromMenu, gPostMenuFieldCallback, Soft-Boiled) is in menus/partyMenu.ts, the
// banner with the mon in world/fieldMoveShowMon.ts and the field effect script interpreter in
// world/fieldEffectScripts.ts. docs/DEV_NOTES.md "Field moves" says how to add another field move.
//
// The field is reached through `FieldMoveHost` (OverworldScene) and the player avatar's host (locks,
// tasks, objects). Like the C, LockPlayerFieldControls is a flag (sLockFieldControls) here; the field's lock
// is a counter, so this module holds one count while its flag is set.

import Phaser from 'phaser';
import { K } from '../battle/constants';
import { state } from '../battle/env';
import { Cos, Sin } from '../battle/trig';
import { gfx, gfx16 } from '../gba/gfx';
import { testEvent } from '../dev/testHooks';
import type { ObjectEvent } from '../entities/ObjectEvent';
import { FieldCallback_PrepareFadeInFromMenu, GetCursorSelectionMonId, registerFieldMoveSetUp, setPostMenuFieldCallback } from '../menus/partyMenu';
import { gFieldCallback2 } from '../menus/fieldCallbacks';
import type { Direction } from './direction';
import { FieldEffectActiveListContains, FieldEffectActiveListRemove, FieldEffectStart, gFieldEffectArguments, registerFieldEffectNatives } from './fieldEffectScripts';
import { loadShowMonGfx, setShowMonHost } from './fieldMoveShowMon';
import { SetUpFieldMove_Flash as SetUpFieldMove_FlashCheck } from './flash';
import { objectDepth } from './MapChunk';
import {
  avatarField,
  ClearPlayerHeldMovement,
  GetPlayerAvatarGraphicsIdByCurrentState,
  GetPlayerAvatarGraphicsIdByStateId,
  GetPlayerFacingDirection,
  GetXYCoordsOneStepInFrontOfPlayer,
  gPlayerAvatar,
  PLAYER_AVATAR_FLAG,
  PlayerGetDestCoords,
  PlayerGetElevation,
  playerObj,
  ResetInitialPlayerAvatarState,
  SetPlayerAvatarTransitionFlags,
} from './playerAvatar';
import { cacheMapSection } from './regionMap';
import { setRegionMapField, type RegionMapWarp } from '../menus/regionMap';
import type { FieldEffectSprite } from '../entities/FieldEffects';
import { registerFly } from './fly';
import { registerSurfAndWaterfall } from './surf';
import type { TileInfo } from './World';
import { directionalAction } from '../entities/movementActions';

import { SetUpFieldMove_Strength } from './strength'; // fldeff_strength.c (W-strength)

/** What the field moves need from the field (OverworldScene). */
export interface FieldMoveHost {
  readonly scene: Phaser.Scene;
  /** gMapHeader.mapType (MAP_TYPE_*) */
  mapType(): number;
  /** gMapHeader.allowEscaping (CanUseEscapeRopeOnCurrMap) */
  allowEscaping(): boolean;
  /** gMapHeader.cave (a dark cave that Flash lights) */
  cave(): boolean;
  /** FldEff_UseFlash (world/flash.ts, run by OverworldScene.useFlash) */
  useFlash(): void;
  /** gSaveBlock1Ptr->location: the current map's MAP_* id */
  mapId(): string;
  /** gSaveBlock1Ptr->pos: the player's map-local position */
  playerLocal(): { x: number; y: number };
  /** The map grid at world coordinates (MapGridGetMetatileIdAt, MapGridGetElevationAt, attributes). */
  tileAt(x: number, y: number): TileInfo;
  /** MapGridSetMetatileIdAt (world coordinates; the metatile's collision bits are cleared) and its redraw. */
  setMetatileIdAt(x: number, y: number, metatile: number): void;
  /** The world position of a map-local tile of the current map. */
  localToWorld(x: number, y: number): { x: number; y: number };
  /** gObjectEvents[i].localId */
  localIdOf(obj: ObjectEvent): number | undefined;
  /** ScriptContext_SetupScript */
  setupScript(label: string): void;
  /** ScriptContext_Enable: a script stopped by `waitstate` after `dofieldeffect` runs on. */
  scriptContextEnable(): void;
  /** RockSmashWildEncounter's encounter check; starts the battle and returns true on an encounter. */
  rockSmashWildEncounter(): boolean;
  /** SweetScentWildEncounter */
  sweetScentWildEncounter(): boolean;
  /**
   * Sweet Scent's BeginNormalPaletteFade(all but the player's palette, 4, from, to, RGB(31, 0, 0)); the wait
   * is !gPaletteFade.active. `clear` drops the tint (the battle's return reloads the palettes).
   */
  sweetScentFade(from: number, to: number): () => boolean;
  clearSweetScentFade(): void;
  /** The field on the GBA layer, for the show-mon banner (FieldGbaScreen); its graphics' symbols. */
  gbaScreenGfxSymbols(): string[];
  startGbaScreen(): void;
  stopGbaScreen(): void;
  /** The camera's top edge in world pixels (gSpriteCoordOffsetY's counterpart). */
  cameraTop(): number;
  /** WarpFadeOutScreen toward a map (to white into a cave); the wait is !gPaletteFade.active. */
  warpFadeOutScreen(mapId: string): () => boolean;
  /**
   * WarpIntoMap + SetMainCallback2(CB2_LoadMap) to a map position (warp id -1), from the faded screen,
   * with gFieldCallback = `fieldCallback`, which runs once the map is loaded instead of the default exit.
   */
  warpIntoMap(mapId: string, x: number, y: number, fieldCallback: () => void): void;
  /** WarpFadeInScreen after such a warp: the wait is IsWeatherNotFadingIn. */
  warpFadeInScreen(): () => boolean;
  /** A map header's regionMapSectionId (MAPSEC_*), loading the header if needed. */
  loadMapSection(mapId: string): Promise<number>;
  /** A map header's region map section, map type and layout size (Overworld_GetMapHeaderByGroupAndId). */
  loadMapHeader(mapId: string): Promise<{ mapsec: number; mapType: number; width: number; height: number } | undefined>;
  /** GetHealLocation(HEAL_LOCATION_*) */
  healLocation(id: number): { map: string; x: number; y: number } | undefined;
  /** The camera's top-left corner in world pixels (screen coordinates + this = world). */
  camera(): { x: number; y: number };
  /** CreateSpriteAtEnd with a gFieldEffectObjectTemplate_* (field_effects/objects.json), world pixels. */
  createFieldEffectSprite(fldEff: string, template: string, x: number, y: number, subpriority: number, callback: (s: FieldEffectSprite) => void): FieldEffectSprite;
}

let host: FieldMoveHost | undefined;

export function setFieldMoveHost(h: FieldMoveHost): void {
  host = h;
  setShowMonHost({
    isOutdoors: () => IsMapTypeOutdoors(h.mapType()),
    startGbaScreen: () => h.startGbaScreen(),
    stopGbaScreen: () => h.stopGbaScreen(),
  });
}

function field(): FieldMoveHost {
  if (!host) throw new Error('[field moves] no field host');
  return host;
}

/** The field host, for field moves ported in their own modules (world/fly.ts). */
export const fieldMoveHost = field;

// ------------------------------------------------------------------ overworld.c helpers

/** IsMapTypeOutdoors */
export function IsMapTypeOutdoors(mapType: number): boolean {
  return [K.MAP_TYPE_ROUTE, K.MAP_TYPE_TOWN, K.MAP_TYPE_UNDERWATER, K.MAP_TYPE_CITY, K.MAP_TYPE_OCEAN_ROUTE].includes(mapType);
}

/** Overworld_MapTypeAllowsTeleportAndFly */
export function Overworld_MapTypeAllowsTeleportAndFly(mapType: number): boolean {
  return [K.MAP_TYPE_ROUTE, K.MAP_TYPE_TOWN, K.MAP_TYPE_OCEAN_ROUTE, K.MAP_TYPE_CITY].includes(mapType);
}

/** CanUseEscapeRopeOnCurrMap (item_use.c) */
export function CanUseEscapeRopeOnCurrMap(): boolean {
  return field().allowEscaping();
}

/** Overworld_ResetStateAfterTeleport / Overworld_ResetStateAfterDigEscRope (the same in FRLG) */
function Overworld_ResetStateAfterTeleport(): void {
  ResetInitialPlayerAvatarState();
  state.setFlag('FLAG_SYS_ON_CYCLING_ROAD', false);
  state.setVar('VAR_MAP_SCENE_ROUTE16', 0);
  state.setFlag('FLAG_SYS_CRUISE_MODE', false);
  state.setFlag('FLAG_SYS_SAFARI_MODE', false);
  state.setVar('VAR_MAP_SCENE_FUCHSIA_CITY_SAFARI_ZONE_ENTRANCE', 0);
  state.setFlag('FLAG_SYS_USE_STRENGTH', false);
  state.setFlag('FLAG_SYS_FLASH_ACTIVE', false);
  state.setFlag('FLAG_SYS_QL_DEPARTED', false);
  state.setVar('VAR_QL_ENTRANCE', 0);
}
export const Overworld_ResetStateAfterDigEscRope = Overworld_ResetStateAfterTeleport;
/** Overworld_ResetStateAfterFly (the same in FRLG) */
export const Overworld_ResetStateAfterFly = Overworld_ResetStateAfterTeleport;

/**
 * UpdateEscapeWarp (SetupWarp): leaving an outdoor map (but Viridian Forest) for one that isn't, remember
 * where to come back to: the warp's tile, one step south unless the player faces south.
 */
export function UpdateEscapeWarp(fromMapType: number, toMapType: number, localX: number, localY: number): void {
  if (IsMapTypeOutdoors(fromMapType) && !IsMapTypeOutdoors(toMapType) && field().mapId() !== 'MAP_VIRIDIAN_FOREST') {
    const delta = GetPlayerFacingDirection() !== 'down' ? 1 : 0;
    SetEscapeWarp(field().mapId(), -1, localX, localY + delta);
  }
}

/** SetEscapeWarp (overworld.c; also ScrCmd_setescapewarp) */
export function SetEscapeWarp(mapId: string, warpId: number, x: number, y: number): void {
  state.escapeWarp = { mapId, warpId, x, y };
}

/**
 * Load the map headers the party menu's Teleport / Dig prompts name and the region map (the fly map and the
 * Town Map) reads (the C reads them synchronously), and hand the region map the player's location.
 */
export async function prepareFieldMoveMenu(): Promise<void> {
  const h = field();
  const maps = [state.lastHealLocation?.map, state.escapeWarp?.mapId].filter((m): m is string => !!m);
  await Promise.all(maps.map(async (m) => cacheMapSection(m, await h.loadMapSection(m))));
  await prepareRegionMap();
}

/** setRegionMapField: gMapHeader, gSaveBlock1Ptr->location / pos and the escape / dynamic warps' headers. */
export async function prepareRegionMap(): Promise<void> {
  const h = field();
  const mapId = h.mapId();
  const warp = async (w: { mapId: string; x: number; y: number } | undefined): Promise<RegionMapWarp | undefined> => {
    const header = w && (await h.loadMapHeader(w.mapId));
    return w && header ? { mapsec: header.mapsec, width: header.width, height: header.height, x: w.x, y: w.y } : undefined;
  };
  const [current, escapeWarp, dynamicWarp] = await Promise.all([h.loadMapHeader(mapId), warp(state.escapeWarp), warp(state.dynamicWarp)]);
  const pos = h.playerLocal();
  setRegionMapField({
    mapId,
    mapType: h.mapType(),
    mapsec: current?.mapsec ?? K.MAPSEC_NONE,
    width: current?.width ?? 0,
    height: current?.height ?? 0,
    x: pos.x,
    y: pos.y,
    escapeWarp,
    dynamicWarp,
  });
}

// ------------------------------------------------------------------ controls

/** sLockFieldControls */
let sLockFieldControls = false;

/** LockPlayerFieldControls */
export function LockPlayerFieldControls(): void {
  if (sLockFieldControls) return;
  sLockFieldControls = true;
  avatarField().lockPlayerFieldControls();
}

/** UnlockPlayerFieldControls */
export function UnlockPlayerFieldControls(): void {
  if (!sLockFieldControls) return;
  sLockFieldControls = false;
  avatarField().unlockPlayerFieldControls();
}

/**
 * ScriptContext_Enable for a script that `dofieldeffect` + `waitstate` stopped. The script runs with the
 * controls locked and unlocks them when it ends (ScriptContext_RunScript); here the running script holds the
 * field's input instead, so the field move's own lock goes now.
 */
export function ScriptContext_Enable(): void {
  field().scriptContextEnable();
  UnlockPlayerFieldControls();
}

/** ScriptContext_SetupScript from a field effect, which hands its controls lock to the script likewise. */
export function ScriptContext_SetupScript(label: string): void {
  field().setupScript(label);
  UnlockPlayerFieldControls();
}

/** CreateTask on the field: `tick` runs once a frame until it returns true. */
export function CreateTask(tick: () => boolean): void {
  avatarField().createTask(tick);
}

// ------------------------------------------------------------------ fldeff_rocksmash.c: the shared parts

/** gPlayerFacingPosition (struct MapPosition), in world coordinates */
const gPlayerFacingPosition = { x: 0, y: 0, elevation: 0 };

/** CheckObjectGraphicsInFrontOfPlayer: sets gSpecialVar_LastTalked to the object if it has those graphics. */
export function CheckObjectGraphicsInFrontOfPlayer(graphicsId: string): boolean {
  const front = GetXYCoordsOneStepInFrontOfPlayer();
  gPlayerFacingPosition.x = front.x;
  gPlayerFacingPosition.y = front.y;
  gPlayerFacingPosition.elevation = PlayerGetElevation();
  const obj = avatarField().objectAtPosition(front.x, front.y, gPlayerFacingPosition.elevation);
  if (!obj || avatarField().graphicsIdOf(obj) !== graphicsId) return false;
  state.setVar('VAR_LAST_TALKED', field().localIdOf(obj) ?? 0);
  return true;
}

/** sAnim_FieldMove: the player's field move pose (ANIM_FIELD_MOVE), as [frame, duration]. */
const FIELD_MOVE_POSE: [number, number][] = [
  [0, 4],
  [1, 4],
  [2, 4],
  [3, 4],
  [4, 8],
];

/**
 * StartPlayerAvatarSummonMonForFieldMoveAnim + MOVEMENT_ACTION_START_ANIM_IN_DIRECTION: the field move
 * graphics and their one animation. Returns ObjectEventCheckHeldMovementStatus for it (true once ended).
 */
export function StartPlayerAvatarSummonMonForFieldMoveAnim(): () => boolean {
  const player = playerObj();
  const gfxId = GetPlayerAvatarGraphicsIdByStateId(K.PLAYER_AVATAR_GFX_FIELD_MOVE);
  const info = avatarField().spriteInfo(gfxId);
  if (info) player.setGraphics(info, gfxId);
  let frame = 0;
  const total = FIELD_MOVE_POSE.reduce((n, [, d]) => n + d, 0);
  return () => {
    // AnimateSprite: the frame for this tick, then the anim ends after its last frame's duration
    let t = frame++;
    for (const [image, d] of FIELD_MOVE_POSE) {
      if (t < d) {
        player.sprite.setFrame(image);
        player.sprite.setFlipX(false);
        break;
      }
      t -= d;
    }
    return frame > total;
  };
}

/** The banner's graphics (fieldMoveShowMon.ts), for a field move that starts FLDEFF_FIELD_MOVE_SHOW_MON_INIT itself. */
export function LoadFieldMoveShowMonGfx(): Promise<void> {
  return loadShowMonGfx(field().gbaScreenGfxSymbols());
}

/**
 * CreateFieldEffectShowMon → Task_FieldEffectShowMon_Init / _WaitPlayerAnim / _WaitFldeff / _Cleanup:
 * the player's pose, FLDEFF_FIELD_MOVE_SHOW_MON_INIT (the banner), then the move's own function
 * (FLDEFF_SET_FUNC_TO_DATA / FLDEFF_CALL_FUNC_IN_DATA). The banner's graphics load during the pose.
 */
export function CreateFieldEffectShowMon(func: () => void): void {
  const front = GetXYCoordsOneStepInFrontOfPlayer();
  gPlayerFacingPosition.x = front.x;
  gPlayerFacingPosition.y = front.y;
  let loaded = false;
  void loadShowMonGfx(field().gbaScreenGfxSymbols()).then(() => (loaded = true));
  let step: 'init' | 'anim' | 'fldeff' | 'cleanup' = 'init';
  let anim: () => boolean = () => true;
  CreateTask(() => {
    const player = playerObj();
    switch (step) {
      case 'init':
        LockPlayerFieldControls();
        gPlayerAvatar.preventStep = true;
        if (!player.movementOverridden || player.clearHeldMovementIfFinished()) {
          // (the MAP_TYPE_UNDERWATER branch is an R/S leftover)
          anim = StartPlayerAvatarSummonMonForFieldMoveAnim();
          anim();
          step = 'anim';
        }
        return false;
      case 'anim':
        // Task_FieldEffectShowMon_WaitPlayerAnim (+ the banner's graphics)
        if (anim() && loaded) {
          FieldEffectStart('FLDEFF_FIELD_MOVE_SHOW_MON_INIT');
          step = 'fldeff';
        }
        return false;
      case 'fldeff': {
        // Task_FieldEffectShowMon_WaitFldeff
        if (FieldEffectActiveListContains('FLDEFF_FIELD_MOVE_SHOW_MON')) return false;
        const gfxId = GetPlayerAvatarGraphicsIdByCurrentState();
        const info = gfxId && avatarField().spriteInfo(gfxId);
        if (gfxId && info) player.setGraphics(info, gfxId); // StartSpriteAnim(ANIM_STD_FACE_*): the standing frame
        player.face(GetPlayerFacingDirection());
        FieldEffectActiveListRemove('FLDEFF_FIELD_MOVE_SHOW_MON');
        step = 'cleanup';
        return false;
      }
      case 'cleanup':
        // Task_FieldEffectShowMon_Cleanup
        func();
        gPlayerAvatar.preventStep = false;
        return true;
    }
  });
}

/** SetUpFieldMove_RockSmash */
function SetUpFieldMove_RockSmash(): boolean {
  if (CheckObjectGraphicsInFrontOfPlayer('OBJ_EVENT_GFX_ROCK_SMASH_ROCK')) {
    gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
    setPostMenuFieldCallback(FieldCallback_UseRockSmash);
    return true;
  }
  return false;
}

function FieldCallback_UseRockSmash(): void {
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
  ScriptContext_SetupScript('EventScript_FldEffRockSmash');
}

function FldEff_UseRockSmash(): boolean {
  CreateFieldEffectShowMon(StartRockSmashFieldEffect);
  // (IncrementGameStat(GAME_STAT_USED_ROCK_SMASH): game stats aren't kept)
  return false;
}

function StartRockSmashFieldEffect(): void {
  // PlaySE(SE_M_ROCK_THROW): no audio
  FieldEffectActiveListRemove('FLDEFF_USE_ROCK_SMASH');
  ScriptContext_Enable();
}

/** RockSmashWildEncounter (special): VAR_RESULT is whether a battle starts. */
export function RockSmashWildEncounter(): boolean {
  const started = field().rockSmashWildEncounter();
  state.setVar('VAR_RESULT', started ? 1 : 0);
  return started;
}

// ------------------------------------------------------------------ fldeff_cut.c

const CUT_GRASS_SPRITE_COUNT = 8;
const CUT_SIDE = 3;
/** TILE_TERRAIN_GRASS (global.fieldmap.h's enum) and metatile_behavior.c's sTileBitAttributes */
const TILE_TERRAIN_GRASS = 1;
const sTileBitAttributes = [0, 1 << 0, 1 << 1, 1 << 2, 1 << 3];

/** sScheduleOpenDottedHole */
let sScheduleOpenDottedHole = false;

/** sCutGrassMetatileMapping */
const sCutGrassMetatileMapping = (): [number, number][] =>
  [
    ['General_Plain_Grass', 'General_Plain_Mowed'],
    ['General_ThinTreeTop_Grass', 'General_ThinTreeTop_Mowed'],
    ['General_WideTreeTopLeft_Grass', 'General_WideTreeTopLeft_Mowed'],
    ['General_WideTreeTopRight_Grass', 'General_WideTreeTopRight_Mowed'],
    ['CeladonCity_CyclingRoad_Grass', 'CeladonCity_CyclingRoad_Mowed'],
    ['FuchsiaCity_SafariZoneTreeTopLeft_Grass', 'FuchsiaCity_SafariZoneTreeTopLeft_Mowed'],
    ['FuchsiaCity_SafariZoneTreeTopMiddle_Grass', 'FuchsiaCity_SafariZoneTreeTopMiddle_Mowed'],
    ['FuchsiaCity_SafariZoneTreeTopRight_Grass', 'FuchsiaCity_SafariZoneTreeTopRight_Mowed'],
    ['ViridianForest_HugeTreeTopMiddle_Grass', 'ViridianForest_HugeTreeTopMiddle_Mowed'],
  ].map(([a, b]) => [K[`METATILE_${a}`], K[`METATILE_${b}`]]);

/** MetatileAtCoordsIsGrassTile: TestMetatileAttributeBit(METATILE_ATTRIBUTE_TERRAIN, TILE_TERRAIN_GRASS) */
function MetatileAtCoordsIsGrassTile(x: number, y: number): boolean {
  return ((sTileBitAttributes[field().tileAt(x, y).terrain] ?? 0) & TILE_TERRAIN_GRASS) !== 0;
}

/** Calls `fn` for each tile of the 3x3 square around the player at the player's elevation. */
function forEachCutTile(fn: (x: number, y: number) => boolean | void): boolean {
  for (let i = 0; i < CUT_SIDE; i++) {
    const y = gPlayerFacingPosition.y - 1 + i;
    for (let j = 0; j < CUT_SIDE; j++) {
      const x = gPlayerFacingPosition.x - 1 + j;
      if (field().tileAt(x, y).elevation === gPlayerFacingPosition.elevation && MetatileAtCoordsIsGrassTile(x, y)) {
        if (fn(x, y)) return true;
      }
    }
  }
  return false;
}

/** SetUpFieldMove_Cut: the Ruin Valley braille, a cut tree in front, or grass around the player. */
// ------------------------------------------------------------------ fldeff_flash.c (party menu side)

/** SetUpFieldMove_Flash (fldeff_flash.c): the check is world/flash.ts's; the darkness lives there too. */
function SetUpFieldMove_Flash(): boolean {
  if (!SetUpFieldMove_FlashCheck(state, field().cave())) return false;
  gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
  setPostMenuFieldCallback(FieldCallback_Flash);
  return true;
}

/** FieldCallback_Flash: the mon banner, then FldEff_UseFlash. */
function FieldCallback_Flash(): void {
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
  CreateFieldEffectShowMon(() => field().useFlash());
}

function SetUpFieldMove_Cut(): boolean {
  sScheduleOpenDottedHole = false;
  if (CutMoveRuinValleyCheck()) {
    sScheduleOpenDottedHole = true;
    gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
    setPostMenuFieldCallback(FieldCallback_CutGrass);
    return true;
  }
  if (CheckObjectGraphicsInFrontOfPlayer('OBJ_EVENT_GFX_CUT_TREE')) {
    gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
    setPostMenuFieldCallback(FieldCallback_CutTree);
    return true;
  }
  const dest = PlayerGetDestCoords();
  gPlayerFacingPosition.x = dest.x;
  gPlayerFacingPosition.y = dest.y;
  if (forEachCutTile(() => true)) {
    gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
    setPostMenuFieldCallback(FieldCallback_CutGrass);
    return true;
  }
  return false;
}

function FieldCallback_CutGrass(): void {
  FieldEffectStart('FLDEFF_USE_CUT_ON_GRASS');
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
}

function FldEff_UseCutOnGrass(): boolean {
  CreateFieldEffectShowMon(FieldMoveCallback_CutGrass);
  // (IncrementGameStat(GAME_STAT_USED_CUT))
  return false;
}

function FieldCallback_CutTree(): void {
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
  ScriptContext_SetupScript('EventScript_FldEffCut');
}

function FldEff_UseCutOnTree(): boolean {
  CreateFieldEffectShowMon(FieldMoveCallback_CutTree);
  return false;
}

function FieldMoveCallback_CutGrass(): void {
  FieldEffectActiveListRemove('FLDEFF_USE_CUT_ON_GRASS');
  if (sScheduleOpenDottedHole) CutMoveOpenDottedHoleDoor();
  else FieldEffectStart('FLDEFF_CUT_GRASS');
}

/** FldEff_CutGrass: mow the grass around the player and send 8 cut grass sprites spinning out. */
function FldEff_CutGrass(): boolean {
  // PlaySE(SE_M_CUT): no audio
  const dest = PlayerGetDestCoords();
  gPlayerFacingPosition.x = dest.x;
  gPlayerFacingPosition.y = dest.y;
  forEachCutTile((x, y) => {
    SetCutGrassMetatileAt(x, y);
    EnableObjectGroundEffectsByXY(x, y);
  });
  // DrawWholeMapView: setMetatileIdAt redraws the cells
  testEvent('cutGrass');
  startCutGrassSprites();
  return false;
}

function SetCutGrassMetatileAt(x: number, y: number): void {
  const metatileId = field().tileAt(x, y).metatile;
  for (const [grass, mowed] of sCutGrassMetatileMapping()) {
    if (grass === metatileId) {
      field().setMetatileIdAt(x, y, mowed);
      break;
    }
  }
}

/** EnableObjectGroundEffectsByXY */
function EnableObjectGroundEffectsByXY(x: number, y: number): void {
  const obj = avatarField().objectAt(x, y);
  if (obj) obj.triggerGroundEffectsOnMove = true;
}

const CUT_GRASS_TEXTURE = 'fldeff_cut_grass';

/** gFieldEffectObjectPic_CutGrass in gFieldEffectPal_CutGrass, as a Phaser texture (8x8, 4bpp). */
function cutGrassTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(CUT_GRASS_TEXTURE)) return CUT_GRASS_TEXTURE;
  const tiles = gfx('gFieldEffectObjectPic_CutGrass');
  const pal = gfx16('gFieldEffectPal_CutGrass');
  const tex = scene.textures.createCanvas(CUT_GRASS_TEXTURE, 8, 8)!;
  const img = tex.context.createImageData(8, 8);
  for (let i = 0; i < 64; i++) {
    const c = (tiles[i >> 1] >> ((i & 1) * 4)) & 0xf;
    if (!c) continue;
    const bgr = pal[c];
    img.data.set([((bgr & 0x1f) * 255) / 31, (((bgr >> 5) & 0x1f) * 255) / 31, (((bgr >> 10) & 0x1f) * 255) / 31, 255], i * 4);
  }
  tex.context.putImageData(img, 0, 0);
  tex.refresh();
  return CUT_GRASS_TEXTURE;
}

/** The cut grass graphics (load before FldEff_CutGrass runs). */
export const CUT_GRASS_GFX = ['gFieldEffectObjectPic_CutGrass', 'gFieldEffectPal_CutGrass'];

/**
 * sSpriteTemplate_FldEff_CutGrass ×8 with SpriteCallback_CutGrass_Init / _Run / _Cleanup: created at the
 * player's oam.x + 8, oam.y + 20 (screen-fixed, oam priority 1), each spiralling out from its own angle.
 * The 8 sprites run in step, so one task drives them; the first one's cleanup ends the effect.
 */
function startCutGrassSprites(): void {
  const scene = field().scene;
  const key = cutGrassTexture(scene);
  const player = playerObj();
  const camTop = field().cameraTop();
  const x = player.sprite.x;
  const y = player.feetY - player.info.frameHeight + 20;
  const sprites = Array.from({ length: CUT_GRASS_SPRITE_COUNT }, (_, i) => ({
    image: scene.add.image(x, y, key).setVisible(false),
    data: [0, 0, (i * (0x100 / CUT_GRASS_SPRITE_COUNT)) & 0xff, 0],
  }));
  let initDone = false;
  CreateTask(() => {
    for (const s of sprites) {
      const d = s.data;
      if (!initDone) {
        // SpriteCallback_CutGrass_Init
        d[0] = 8;
        d[1] = 0;
        d[3] = 0;
      } else {
        // SpriteCallback_CutGrass_Run
        const x2 = Sin(d[2], d[0]);
        const y2 = Cos(d[2], d[0]);
        s.image.setPosition(x + x2, y + y2);
        d[2] = (d[2] + 8) & 0xff;
        d[0]++;
        d[0] += d[3] >> 2;
        d[3]++;
        if (d[1] !== 28) d[1]++;
        else d[1] = -1; // callback = SpriteCallback_CutGrass_Cleanup
      }
      s.image.setVisible(initDone).setDepth(objectDepth(1, 0, s.image.y - 4 - camTop));
    }
    if (!initDone) {
      initDone = true;
      return false;
    }
    if (sprites[0].data[1] !== -1) return false;
    // SpriteCallback_CutGrass_Cleanup (the next frame on the GBA)
    for (const s of sprites) s.image.destroy();
    FieldEffectActiveListRemove('FLDEFF_CUT_GRASS'); // FieldEffectStop
    ClearPlayerHeldMovement(); // ClearPlayerHeldMovementAndUnfreezeObjectEvents
    avatarField().unfreezeObjectEvents();
    UnlockPlayerFieldControls();
    return true;
  });
}

function FieldMoveCallback_CutTree(): void {
  // PlaySE(SE_M_CUT): no audio
  FieldEffectActiveListRemove('FLDEFF_USE_CUT_ON_TREE');
  ScriptContext_Enable();
}

/** CutMoveRuinValleyCheck (field_specials.c): cutting the braille in Ruin Valley from (24, 25), facing north. */
function CutMoveRuinValleyCheck(): boolean {
  const pos = field().playerLocal();
  return !state.getFlag('FLAG_USED_CUT_ON_RUIN_VALLEY_BRAILLE') && field().mapId() === 'MAP_SIX_ISLAND_RUIN_VALLEY' && pos.x === 24 && pos.y === 25 && GetPlayerFacingDirection() === 'up';
}

/** CutMoveOpenDottedHoleDoor (field_specials.c): MapGridSetMetatileIdAt(31, 31) is map-local (24, 24). */
function CutMoveOpenDottedHoleDoor(): void {
  const at = field().localToWorld(24, 24);
  field().setMetatileIdAt(at.x, at.y, K.METATILE_SeviiIslands67_DottedHoleDoor_Open);
  // PlaySE(SE_BANG): no audio
  state.setFlag('FLAG_USED_CUT_ON_RUIN_VALLEY_BRAILLE', true);
  UnlockPlayerFieldControls();
}

// ------------------------------------------------------------------ fldeff_sweetscent.c

/** SetUpFieldMove_SweetScent */
function SetUpFieldMove_SweetScent(): boolean {
  gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
  setPostMenuFieldCallback(FieldCallback_SweetScent);
  return true;
}

function FieldCallback_SweetScent(): void {
  FieldEffectStart('FLDEFF_SWEET_SCENT');
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
}

function FldEff_SweetScent(): boolean {
  // (SetWeatherScreenFadeOut: no weather)
  CreateFieldEffectShowMon(StartSweetScentFieldEffect);
  return false;
}

/** StartSweetScentFieldEffect + TrySweetScentEncounter + FailSweetScentEncounter */
function StartSweetScentFieldEffect(): void {
  // PlaySE(SE_M_SWEET_SCENT): no audio
  let fade = field().sweetScentFade(0, 8);
  testEvent('sweetScent');
  FieldEffectActiveListRemove('FLDEFF_SWEET_SCENT');
  let timer = 0; // data[0]
  let failed = false;
  CreateTask(() => {
    if (!fade()) return false;
    if (failed) {
      // FailSweetScentEncounter (WeatherProcessingIdle: no weather)
      field().clearSweetScentFade();
      ScriptContext_SetupScript('EventScript_FailSweetScent');
      return true;
    }
    if (timer !== 64) {
      timer++;
      return false;
    }
    timer = 0;
    if (field().sweetScentWildEncounter()) {
      field().clearSweetScentFade();
      UnlockPlayerFieldControls(); // the battle's return to the field unlocks them (FieldCB_ReturnToFieldNoScriptCheckMusic)
      return true;
    }
    failed = true;
    fade = field().sweetScentFade(8, 0);
    return false;
  });
}

// ------------------------------------------------------------------ fldeff_dig.c, fldeff_teleport.c

/** SetUpFieldMove_Dig */
function SetUpFieldMove_Dig(): boolean {
  if (CanUseEscapeRopeOnCurrMap()) {
    gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
    setPostMenuFieldCallback(FieldCallback_Dig);
    return true;
  }
  return false;
}

function FieldCallback_Dig(): void {
  Overworld_ResetStateAfterDigEscRope();
  FieldEffectStart('FLDEFF_USE_DIG');
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
}

function FldEff_UseDig(): boolean {
  CreateFieldEffectShowMon(StartDigFieldEffect);
  SetPlayerAvatarTransitionFlags(PLAYER_AVATAR_FLAG.ON_FOOT);
  return false;
}

function StartDigFieldEffect(): void {
  FieldEffectActiveListRemove('FLDEFF_USE_DIG');
  CreateTask(() => {
    Task_UseDigEscapeRopeOnField();
    return true;
  });
}

/** Task_UseDigEscapeRopeOnField (item_use.c): Dig's and the Escape Rope's warp out. */
export function Task_UseDigEscapeRopeOnField(): void {
  ResetInitialPlayerAvatarState();
  StartEscapeRopeFieldEffect();
}

/** SetUpFieldMove_Teleport */
function SetUpFieldMove_Teleport(): boolean {
  if (Overworld_MapTypeAllowsTeleportAndFly(field().mapType())) {
    gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
    setPostMenuFieldCallback(FieldCallback_Teleport);
    return true;
  }
  return false;
}

function FieldCallback_Teleport(): void {
  Overworld_ResetStateAfterTeleport();
  FieldEffectStart('FLDEFF_USE_TELEPORT');
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
}

function FldEff_UseTeleport(): boolean {
  CreateFieldEffectShowMon(StartTeleportFieldEffect);
  SetPlayerAvatarTransitionFlags(PLAYER_AVATAR_FLAG.ON_FOOT);
  return false;
}

function StartTeleportFieldEffect(): void {
  FieldEffectActiveListRemove('FLDEFF_USE_TELEPORT');
  CreateTeleportFieldEffectTask();
}

// ------------------------------------------------------------------ field_effect.c: the warps

/** The spin both warps turn the player through (sSpinDirections, spinDirections[]). */
const SPIN: Record<Direction, Direction> = { down: 'left', left: 'up', up: 'right', right: 'down' };

/** ObjectEventTurn */
function ObjectEventTurn(obj: ObjectEvent, dir: Direction): void {
  obj.face(dir);
}

/** The player's sprite drawn `dy` px off its tile (sprite->y / y2 changes; CameraObjectReset2 keeps the camera put). */
function setPlayerSpriteOffset(dy: number): void {
  const p = playerObj();
  p.sprite.setY(p.feetY + p.lift + dy);
}

/** oam.priority / subpriority set directly on the player's sprite (with fixedPriority, or until the next update). */
function setPlayerSpritePriority(priority: number, subpriority: number): void {
  const p = playerObj();
  p.priority = priority;
  p.subpriority = subpriority;
  p.sprite.setDepth(objectDepth(priority, subpriority, p.sprite.y - p.info.frameHeight - field().cameraTop()));
}

/**
 * CreateTeleportFieldEffectTask → Task_DoTeleportFieldEffect: spin, then spin faster while rising off the
 * screen, then the warp to the last heal location with FieldCallback_TeleportIn.
 */
function CreateTeleportFieldEffectTask(): void {
  const data = new Int16Array(16);
  let stage = 0;
  let fadeOut: () => boolean = () => true;
  CreateTask(() => {
    const player = playerObj();
    switch (stage) {
      case 0: // TeleportFieldEffectTask1
        LockPlayerFieldControls();
        avatarField().freezeObjectEvents();
        // CameraObjectReset2
        data[15] = dirNum(GetPlayerFacingDirection());
        stage++;
        return false;
      case 1: // TeleportFieldEffectTask2
        if (data[1] === 0 || --data[1] === 0) {
          ObjectEventTurn(player, SPIN[player.facing]);
          data[1] = 8;
          data[2]++;
        }
        if (data[2] > 7 && data[15] === dirNum(player.facing)) {
          stage++;
          data[1] = 4;
          data[2] = 8;
          data[3] = 1;
          // PlaySE(SE_WARP_IN)
        }
        return false;
      case 2: // TeleportFieldEffectTask3
        if (--data[1] <= 0) {
          data[1] = 4;
          ObjectEventTurn(player, SPIN[player.facing]);
        }
        data[4] += data[3];
        setPlayerSpriteOffset(-data[4]); // sprite->y -= data[3]
        if (--data[2] <= 0) {
          data[2] = 4;
          if (data[3] < 8) data[3] <<= 1;
        }
        if (data[4] > 8) {
          player.fixedPriority = true; // sprite->oam.priority = 1 (it isn't reset until the warp)
          setPlayerSpritePriority(1, player.subpriority);
        }
        if (data[4] >= 0xa8) {
          stage++;
          // TryFadeOutOldMapMusic; WarpFadeOutScreen
          fadeOut = field().warpFadeOutScreen(lastHealMap());
        }
        return false;
      case 3: // TeleportFieldEffectTask4
        if (!fadeOut()) return false;
        // SetWarpDestinationToLastHealLocation; WarpIntoMap; CB2_LoadMap; gFieldCallback = FieldCallback_TeleportIn
        player.fixedPriority = false;
        warpIntoMap(state.lastHealLocation, FieldCallback_TeleportIn);
        return true;
    }
    return true;
  });
}

function lastHealMap(): string {
  return state.lastHealLocation?.map ?? field().mapId();
}

function warpIntoMap(dest: { map: string; x: number; y: number } | undefined, fieldCallback: () => void): void {
  if (!dest) {
    console.warn('[field moves] no warp destination');
    dest = { map: field().mapId(), ...field().playerLocal() };
  }
  testEvent('fieldMoveWarp', { map: dest.map });
  field().warpIntoMap(dest.map, dest.x, dest.y, fieldCallback);
}

/** FieldCallback_TeleportIn → Task_DoTeleportInFieldEffect: drop in from above the screen, spinning, then face the old way. */
function FieldCallback_TeleportIn(): void {
  const fadeIn = field().warpFadeInScreen();
  LockPlayerFieldControls();
  avatarField().freezeObjectEvents();
  const player = playerObj();
  player.setVisible(false);
  const data = new Int16Array(16);
  let stage = 0;
  let y2 = 0;
  CreateTask(() => {
    switch (stage) {
      case 0: // TeleportInFieldEffectTask1
        if (!fadeIn()) return false;
        // y2 = -(sprite->y + centerToCornerVecY + gSpriteCoordOffsetY + 2 * -centerToCornerVecY): the sprite's bottom at the screen's top
        y2 = -(player.feetY - field().cameraTop());
        setPlayerSpriteOffset(y2);
        player.setVisible(true);
        stage++;
        data[1] = 8;
        data[2] = 1;
        data[15] = dirNum(GetPlayerFacingDirection());
        // PlaySE(SE_WARP_IN)
        return false;
      case 1: // TeleportInFieldEffectTask2
        y2 += data[1];
        if (y2 >= -8) {
          if (data[13] === 0) {
            data[13]++;
            player.triggerGroundEffectsOnMove = true; // the spawn ground effects reset the priority
            player.fixedPriority = false;
          }
        } else {
          player.fixedPriority = true;
          setPlayerSpritePriority(1, player.subpriority);
        }
        if (y2 >= -0x30 && data[1] > 1 && !(y2 & 1)) data[1]--;
        if (--data[2] === 0) {
          data[2] = 4;
          ObjectEventTurn(player, SPIN[player.facing]);
        }
        if (y2 >= 0) {
          y2 = 0;
          stage++;
          data[1] = 1;
          data[2] = 0;
        }
        setPlayerSpriteOffset(y2);
        return false;
      case 2: // TeleportInFieldEffectTask3
        if (--data[1] === 0) {
          ObjectEventTurn(player, SPIN[player.facing]);
          data[1] = 8;
          if (++data[2] > 4 && data[15] === dirNum(player.facing)) {
            UnlockPlayerFieldControls();
            // CameraObjectReset1
            avatarField().unfreezeObjectEvents();
            testEvent('fieldMoveWarpDone');
            return true;
          }
        }
        return false;
    }
    return true;
  });
}

/**
 * StartEscapeRopeFieldEffect → Task_EscapeRopeWarpOut: spin faster and faster, rise off the screen, then
 * warp to the escape warp with FieldCallback_EscapeRopeExit.
 */
function StartEscapeRopeFieldEffect(): void {
  LockPlayerFieldControls();
  avatarField().freezeObjectEvents();
  const spin = { delay: 0, turns: 0 }; // tSpinDelay, tNumTurns
  let timer = 0;
  let offscreen = false;
  let movingState = 0; // tMovingState
  let offsetY = 0; // tOffsetY
  let fadeOut: () => boolean = () => true;
  let init = true;
  /** WarpOutObjectEventUpwards: TRUE while still rising. */
  const WarpOutObjectEventUpwards = (): boolean => {
    const player = playerObj();
    switch (movingState) {
      case 0:
        // CameraObjectReset2
        movingState++;
      // fallthrough
      case 1:
        offsetY -= 8;
        setPlayerSpriteOffset(offsetY);
        if (offsetY <= -16) {
          player.fixedPriority = true;
          setPlayerSpritePriority(1, 0);
          movingState++;
        }
        break;
      case 2:
        offsetY -= 8;
        setPlayerSpriteOffset(offsetY);
        if (offsetY <= -88) {
          movingState++;
          return false;
        }
        break;
      case 3:
        return false;
    }
    return true;
  };
  CreateTask(() => {
    const player = playerObj();
    if (init) {
      // EscapeRopeWarpOutEffect_Init
      init = false;
      return false;
    }
    // EscapeRopeWarpOutEffect_Spin
    SpinObjectEvent(player, spin);
    if (timer < 60) {
      timer++;
      // (timer 20: PlaySE(SE_WARP_IN))
    } else if (!offscreen && !WarpOutObjectEventUpwards()) {
      // TryFadeOutOldMapMusic; WarpFadeOutScreen
      fadeOut = field().warpFadeOutScreen(escapeWarpDest().map);
      offscreen = true;
    }
    if (offscreen && fadeOut()) {
      // SetObjectEventDirection(DIR_NONE); SetWarpDestinationToEscapeWarp; WarpIntoMap
      player.fixedPriority = false;
      warpIntoMap(escapeWarpDest(), FieldCallback_EscapeRopeExit);
      return true;
    }
    return false;
  });
}

/** gSaveBlock1Ptr->escapeWarp, as a position (the map's warp id is always -1 when set by the field). */
function escapeWarpDest(): { map: string; x: number; y: number } {
  const w = state.escapeWarp;
  if (w) return { map: w.mapId, x: w.x, y: w.y };
  console.warn('[field moves] no escape warp set');
  return { map: lastHealMap(), x: state.lastHealLocation?.x ?? 0, y: state.lastHealLocation?.y ?? 0 };
}

/** SpinObjectEvent: one turn of sSpinDirections every 12 >> turns frames (a held FACE movement). */
function SpinObjectEvent(player: ObjectEvent, spin: { delay: number; turns: number }): Direction {
  if (!player.movementOverridden || player.clearHeldMovementIfFinished()) {
    if (spin.delay !== 0 && --spin.delay !== 0) return player.facing;
    const next = SPIN[player.facing];
    player.setHeldMovement(directionalAction('FACE', next));
    if (spin.turns < 12) spin.turns++;
    spin.delay = 12 >> spin.turns;
    return next;
  }
  return player.facing;
}

/** FieldCallback_EscapeRopeExit → Task_EscapeRopeWarpIn: drop in from 88 px up while spinning, then face the old way. */
function FieldCallback_EscapeRopeExit(): void {
  const fadeIn = field().warpFadeInScreen();
  LockPlayerFieldControls();
  avatarField().freezeObjectEvents();
  const player = playerObj();
  player.setVisible(false);
  let stage = 0;
  let originalDir: Direction = 'down';
  let movingState = 0;
  let offsetY = 0;
  let savedPriority = 0;
  let timer = 0;
  let spinEnded = false;
  let currentDir: Direction | undefined;
  const spin = { delay: 0, turns: 0 };
  CreateTask(() => {
    if (stage === 0) {
      // EscapeRopeWarpInEffect_Init
      if (!fadeIn()) return false;
      // PlaySE(SE_WARP_OUT)
      originalDir = GetPlayerFacingDirection();
      stage++;
      return false;
    }
    // EscapeRopeWarpInEffect_Spin → WarpInObjectEventDownwards
    let moving = true;
    switch (movingState) {
      case 0:
        offsetY = -88;
        savedPriority = player.priority;
        player.fixedPriority = true;
        setPlayerSpritePriority(1, 0);
        movingState = 1;
      // fallthrough
      case 1:
        offsetY += 4;
        if (offsetY >= -16) {
          player.fixedPriority = false;
          player.priority = savedPriority;
          movingState = 2;
        }
        break;
      case 2:
        offsetY += 4;
        if (offsetY >= 0) {
          // PlaySE(SE_CLICK); CameraObjectReset1
          movingState = 3;
          moving = false;
        }
        break;
      case 3:
        moving = false;
        break;
    }
    setPlayerSpriteOffset(Math.min(offsetY, 0));
    player.setVisible(true);
    if (timer < 8) {
      timer++;
    } else if (!spinEnded) {
      timer++;
      currentDir = SpinObjectEvent(player, spin);
      if (timer >= 50 && currentDir === originalDir) spinEnded = true;
    }
    if (!moving && currentDir === originalDir && player.checkHeldMovementStatus() === 1) {
      player.fixedPriority = false;
      UnlockPlayerFieldControls();
      avatarField().unfreezeObjectEvents();
      testEvent('fieldMoveWarpDone');
      return true;
    }
    return false;
  });
}

/** DIR_* numbers */
function dirNum(dir: Direction): number {
  return { down: K.DIR_SOUTH, up: K.DIR_NORTH, left: K.DIR_WEST, right: K.DIR_EAST }[dir];
}

// ------------------------------------------------------------------ registration

registerFieldEffectNatives({
  FldEff_UseCutOnGrass,
  FldEff_UseCutOnTree,
  FldEff_CutGrass,
  FldEff_UseRockSmash,
  FldEff_SweetScent,
  FldEff_UseDig,
  FldEff_UseTeleport,
});

/** sFieldMoveCursorCallbacks' fieldMoveFunc for the field moves ported here. */
export function registerFieldMoves(): void {
  registerFieldMoveSetUp('FIELD_MOVE_CUT', SetUpFieldMove_Cut);
  registerFieldMoveSetUp('FIELD_MOVE_ROCK_SMASH', SetUpFieldMove_RockSmash);
  registerFieldMoveSetUp('FIELD_MOVE_SWEET_SCENT', SetUpFieldMove_SweetScent);
  registerFieldMoveSetUp('FIELD_MOVE_DIG', SetUpFieldMove_Dig);
  registerFieldMoveSetUp('FIELD_MOVE_TELEPORT', SetUpFieldMove_Teleport);
  registerFieldMoveSetUp('FIELD_MOVE_FLASH', SetUpFieldMove_Flash);
  registerSurfAndWaterfall(); // world/surf.ts
  registerFieldMoveSetUp('FIELD_MOVE_STRENGTH', SetUpFieldMove_Strength); // world/strength.ts
  registerFly(); // world/fly.ts
}

/** Graphics the field moves use outside the banner (preload at boot). */
export const fieldMoveGfxSymbols = (): string[] => [...CUT_GRASS_GFX];

