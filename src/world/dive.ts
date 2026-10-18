// Dive, as FireRed compiles it: field_effect.c's FldEff_UseDive / Task_UseDive / DiveFieldEffect_* (gFldEffScript_UseDive),
// field_control_avatar.c's dive_warp, overworld.c's SetDiveWarp / SetDiveWarpDive / SetDiveWarpEmerge and
// field_fadetransition.c's DoDiveWarp. The callers are R/S leftovers: EventScript_DeepWater and
// EventScript_TrySurface (data/scripts/field_moves.inc), which FRLG's GetInteractedWaterScript never returns, and no
// FRLG map has a dive or emerge connection. They run if started (a test does, on a map given a synthetic
// connection).
//
// DoDiveWarp is also the first half of DoFallWarp (world/fallWarp.ts), which swaps in its own field callback.

import { K } from '../battle/constants';
import type { MapConnection } from '../data/types';
import { testEvent } from '../dev/testHooks';
import { PlaySE } from '../gba/sound';
import { FieldEffectActiveListContains, FieldEffectActiveListRemove, FieldEffectStart, gFieldEffectArguments, registerFieldEffectNatives } from './fieldEffectScripts';
import { CreateTask, fieldMoveHost, LoadFieldMoveShowMonGfx, LockPlayerFieldControls, UnlockPlayerFieldControls } from './fieldMoves';
import { avatarField, gPlayerAvatar, PlayerGetDestCoords, playerObj, StoreInitialPlayerAvatarState } from './playerAvatar';

/** What Dive needs from the field beyond the field move host. Implemented by OverworldScene. */
export interface DiveHost {
  /** gMapHeader.connections (incl. CONNECTION_DIVE / CONNECTION_EMERGE) */
  connections(): readonly MapConnection[];
  /** RunOnDiveWarpMapScript: the map's MAP_SCRIPT_ON_DIVE_WARP, run immediately (no FRLG map has one). */
  runOnDiveWarpMapScript(): void;
  /** SetWarpDestination (sWarpDestination, read back by the warp through FieldMoveHost.warpDestination) */
  setWarpDestination(mapId: string, warpId: number, x: number, y: number): void;
}

let host: DiveHost | undefined;

export function setDiveHost(h: DiveHost): void {
  host = h;
}

function diveHost(): DiveHost {
  if (!host) throw new Error('[dive] no field host');
  return host;
}

// ------------------------------------------------------------------ field_effect.c

/**
 * FldEff_UseDive: data[15] = the party index of the mon with Dive, data[14] = gFieldEffectArguments[1] (unused);
 * Task_UseDive runs once now and then every frame. sDiveFieldEffectFuncs all return FALSE, so each frame runs one.
 */
function FldEff_UseDive(): number {
  const data = new Int16Array(16);
  data[15] = gFieldEffectArguments[0];
  data[14] = gFieldEffectArguments[1];
  // The banner's graphics load asynchronously in the port (the C's FldEff_FieldMoveShowMonInit loads them itself).
  let loaded = false;
  void LoadFieldMoveShowMonGfx().then(() => (loaded = true));
  let destroyed = false;
  const sDiveFieldEffectFuncs: (() => boolean)[] = [
    // DiveFieldEffect_Init
    () => {
      gPlayerAvatar.preventStep = true;
      data[0]++;
      return false;
    },
    // DiveFieldEffect_ShowMon (waits for the banner's graphics first)
    () => {
      if (!loaded) return false;
      LockPlayerFieldControls();
      gFieldEffectArguments[0] = data[15];
      FieldEffectStart('FLDEFF_FIELD_MOVE_SHOW_MON_INIT');
      data[0]++;
      testEvent('diveShowMon');
      return false;
    },
    // DiveFieldEffect_TryWarp
    () => {
      const pos = PlayerGetDestCoords();
      if (!FieldEffectActiveListContains('FLDEFF_FIELD_MOVE_SHOW_MON')) {
        const warped = dive_warp(pos, playerObj().currentMetatileBehavior);
        destroyed = true; // DestroyTask(FindTaskIdByFunc(Task_UseDive))
        FieldEffectActiveListRemove('FLDEFF_USE_DIVE');
        testEvent('diveDone', { warped });
      }
      return false;
    },
  ];
  /** Task_UseDive */
  const Task_UseDive = (): boolean => {
    while (!destroyed && sDiveFieldEffectFuncs[data[0]]());
    return destroyed;
  };
  Task_UseDive();
  CreateTask(Task_UseDive);
  return 0;
}

// ------------------------------------------------------------------ field_control_avatar.c

/**
 * dive_warp: underwater (and not under a MB_UNDERWATER_BLOCKED_ABOVE tile), surface through the map's emerge
 * connection; on diveable water, go down through its dive connection. `position` is in world coordinates
 * (the C's map coordinates with MAP_OFFSET); the warp lands on the same map-local tile of the other map.
 */
export function dive_warp(position: { x: number; y: number }, metatileBehavior: number): boolean {
  const field = fieldMoveHost();
  const b = avatarField().behaviors;
  const origin = field.localToWorld(0, 0);
  const x = position.x - origin.x;
  const y = position.y - origin.y;
  if (field.mapType() === K.MAP_TYPE_UNDERWATER && !b.isUnableToEmerge(metatileBehavior)) {
    if (SetDiveWarpEmerge(x, y)) {
      StoreInitialPlayerAvatarState();
      DoDiveWarp();
      PlaySE(K.SE_M_DIVE);
      return true;
    }
  } else if (b.isDiveable(metatileBehavior)) {
    if (SetDiveWarpDive(x, y)) {
      StoreInitialPlayerAvatarState();
      DoDiveWarp();
      PlaySE(K.SE_M_DIVE);
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ overworld.c

/** GetMapConnection: the current map's first connection in that direction. */
function GetMapConnection(dir: MapConnection['direction']): MapConnection | undefined {
  return diveHost().connections().find((c) => c.direction === dir);
}

/**
 * sFixedDiveWarp: only ScrCmd_setdivewarp sets it, which no FRLG script uses (and the port doesn't have), and
 * ApplyCurrentWarp puts it back to sDummyWarpData on every warp; so it is always the dummy warp here.
 */
const sFixedDiveWarpIsDummy = true;

/**
 * SetDiveWarp: SetWarpDestination to the same map-local tile of the connected map (warp id -1); without such a
 * connection, the map's ON_DIVE_WARP script may set sFixedDiveWarp (IsDummyWarp → FALSE).
 */
function SetDiveWarp(dir: 'dive' | 'emerge', x: number, y: number): boolean {
  const connection = GetMapConnection(dir);
  if (connection) {
    diveHost().setWarpDestination(connection.map, -1, x, y);
    testEvent('diveWarp', { dir, map: connection.map, x, y });
  } else {
    diveHost().runOnDiveWarpMapScript();
    if (sFixedDiveWarpIsDummy) return false;
    // SetWarpDestinationToDiveWarp: unreachable (see sFixedDiveWarpIsDummy)
  }
  return true;
}

/** SetDiveWarpEmerge: SetDiveWarp(CONNECTION_EMERGE, x, y) */
export function SetDiveWarpEmerge(x: number, y: number): boolean {
  return SetDiveWarp('emerge', x, y);
}

/** SetDiveWarpDive: SetDiveWarp(CONNECTION_DIVE, x, y) */
export function SetDiveWarpDive(x: number, y: number): boolean {
  return SetDiveWarp('dive', x, y);
}

// ------------------------------------------------------------------ field_fadetransition.c

/**
 * DoDiveWarp: LockPlayerFieldControls, TryFadeOutOldMapMusic, WarpFadeOutScreen,
 * PlayRainStoppingSoundEffect (no field weather yet), gFieldCallback = FieldCB_DefaultWarpExit and Task_Teleport2Warp: once
 * the fade is over, WarpIntoMap + CB2_LoadMap to the warp destination. `fieldCallback` replaces
 * FieldCB_DefaultWarpExit (DoFallWarp sets gFieldCallback = FieldCB_FallWarpExit right after DoDiveWarp). The
 * destination's map header loads first in the port (WarpFadeOutScreen fades to white into a cave).
 */
export function DoDiveWarp(fieldCallback?: () => void): void {
  LockPlayerFieldControls();
  const field = fieldMoveHost();
  void field.warpDestination().then((dest) => {
    if (!dest) {
      console.warn('[warp] no warp destination set');
      UnlockPlayerFieldControls();
      return;
    }
    const fadeOut = field.warpFadeOutScreen(dest.mapId, true); // TryFadeOutOldMapMusic, WarpFadeOutScreen
    let stage = 0;
    // Task_Teleport2Warp
    CreateTask(() => {
      switch (stage) {
        case 0:
          avatarField().freezeObjectEvents();
          LockPlayerFieldControls();
          stage++;
          return false;
        case 1:
          if (fadeOut()) stage++; // !WaitWarpFadeOutScreen() && BGMusicStopped()
          return false;
        default:
          field.warpIntoMap(dest.mapId, dest.x, dest.y, fieldCallback, dest.warpId);
          return true;
      }
    });
  });
}

// ------------------------------------------------------------------ registration

/** gFldEffScript_UseDive's native (called by registerFieldMoves). */
export function registerDive(): void {
  registerFieldEffectNatives({ FldEff_UseDive });
}
