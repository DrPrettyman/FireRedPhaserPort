// Falling through a hole (MB_FALL_WARP): field_fadetransition.c's DoFallWarp and field_effect.c's
// FieldCB_FallWarpExit / Task_FallWarpFieldEffect. Stepping onto a hole runs EventScript_DoFallWarp
// (data/scripts/hole.inc: the player vanishes, SE_FALL, then `special DoFallWarp`), set up by
// OverworldScene.tryStartWarpEventScript (TryStartWarpEventScript's MetatileBehavior_IsFallWarp branch).
// The holes before the Hall of Fame: Seafoam Islands 1F-B3F, Pokémon Mansion 3F, Victory Road 3F.

import { state } from '../battle/env';
import { testEvent } from '../dev/testHooks';
import { registerSpecials } from '../script/specials';
import { fieldMoveHost, LockPlayerFieldControls, UnlockPlayerFieldControls, CreateTask } from './fieldMoves';
import { objectDepth } from './MapChunk';
import {
  avatarField,
  GetPlayerFacingDirection,
  gPlayerAvatar,
  PLAYER_AVATAR_FLAG,
  PlayerGetDestCoords,
  playerObj,
  SetPlayerAvatarTransitionFlags,
} from './playerAvatar';

/**
 * DoFallWarp: DoDiveWarp (LockPlayerFieldControls, WarpFadeOutScreen, Task_Teleport2Warp: once faded,
 * WarpIntoMap + CB2_LoadMap) to the warp destination SetupWarp stored, with gFieldCallback =
 * FieldCB_FallWarpExit. The script's `waitstate` never ends: the map load ends the script.
 */
export function DoFallWarp(): void {
  LockPlayerFieldControls();
  const host = fieldMoveHost();
  void host.warpDestination().then((dest) => {
    if (!dest) {
      console.warn('[fall warp] no warp destination set');
      UnlockPlayerFieldControls();
      return;
    }
    testEvent('fallWarp', { map: dest.mapId });
    const fadeOut = host.warpFadeOutScreen(dest.mapId);
    CreateTask(() => {
      if (!fadeOut()) return false; // WaitWarpFadeOutScreen
      host.warpIntoMap(dest.mapId, dest.x, dest.y, FieldCB_FallWarpExit, dest.warpId);
      return true;
    });
  });
}

/** The player's sprite drawn `y2` px off its tile (CameraObjectReset2: the camera stays on the tile). */
function setPlayerSpriteY2(y2: number): void {
  const p = playerObj();
  p.sprite.setY(p.feetY + p.lift + y2);
}

/**
 * FieldCB_FallWarpExit: WarpFadeInScreen, LockPlayerFieldControls, FreezeObjectEvents, then
 * Task_FallWarpFieldEffect: the player drops in from the top of the screen, lands (SE_M_STRENGTH, the landing
 * ground effect) and the camera shakes.
 */
function FieldCB_FallWarpExit(): void {
  const host = fieldMoveHost();
  const fadeIn = host.warpFadeInScreen();
  LockPlayerFieldControls();
  avatarField().freezeObjectEvents();
  const player = playerObj();
  const data = new Int16Array(16);
  let y2 = 0;
  // FallWarpEffect_1: CameraObjectReset2; the player invisible, preventStep, facing its way; priority 1 with
  // SUBSPRITES_IGNORE_PRIORITY (drawn over the map's top layer) until it's near the ground.
  player.setVisible(false);
  gPlayerAvatar.preventStep = true;
  player.face(GetPlayerFacingDirection());
  player.fixedPriority = true;
  player.priority = 1;
  data[0] = 1;
  const drawOnTop = () => player.sprite.setDepth(objectDepth(1, player.subpriority, player.sprite.y - player.info.frameHeight - host.cameraTop()));
  CreateTask(() => {
    for (;;) {
      switch (data[0]) {
        case 1: // FallWarpEffect_2: IsWeatherNotFadingIn
          if (fadeIn()) data[0]++;
          return false;
        case 2: // FallWarpEffect_3: y2 puts the sprite's bottom at the screen's top
          y2 = -(player.feetY - host.cameraTop());
          setPlayerSpriteY2(y2);
          drawOnTop();
          data[1] = 1;
          data[2] = 0;
          player.setVisible(true);
          // PlaySE(SE_FALL)
          data[0]++;
          return false;
        case 3: // FallWarpEffect_4
          y2 += data[1];
          if (data[1] < 8) {
            data[2] += data[1];
            if (data[2] & 0xf) data[1] <<= 1;
          }
          if (data[3] === 0 && y2 >= -16) {
            data[3]++;
            player.fixedPriority = false;
            player.triggerGroundEffectsOnMove = true;
          }
          if (y2 >= 0) {
            // PlaySE(SE_M_STRENGTH)
            player.triggerGroundEffectsOnStop = true;
            player.landingJump = true;
            y2 = 0;
            data[0]++;
          }
          setPlayerSpriteY2(y2);
          if (player.fixedPriority) drawOnTop();
          return false;
        case 4: // FallWarpEffect_5: SetCameraPanningCallback(NULL); runs on into _6 this frame
          data[0]++;
          data[1] = 4;
          data[2] = 0;
          testEvent('fallWarpLanded');
          continue;
        case 5: // FallWarpEffect_6: the camera shakes, 4 px then 2 then 1, four frames each
          host.setCameraPanning(data[1]);
          data[1] = -data[1];
          data[2]++;
          if ((data[2] & 3) === 0) data[1] >>= 1;
          if (data[1] === 0) data[0]++;
          return false;
        case 6: {
          // FallWarpEffect_7
          gPlayerAvatar.preventStep = false;
          UnlockPlayerFieldControls();
          // CameraObjectReset1
          avatarField().unfreezeObjectEvents();
          host.setCameraPanning(0); // InstallCameraPanAheadCallback
          const { x, y } = PlayerGetDestCoords();
          if (MetatileBehavior_IsSurfableInSeafoamIslands(x, y)) {
            state.setVar('VAR_TEMP_1', 1);
            SetPlayerAvatarTransitionFlags(PLAYER_AVATAR_FLAG.SURFING);
            // SetHelpContext(HELPCONTEXT_SURFING): no help system
          }
          testEvent('fallWarpDone');
          return true;
        }
      }
      return true;
    }
  });
}

/** MetatileBehavior_IsSurfableInSeafoamIslands: surfable water on Seafoam Islands B3F / B4F. */
function MetatileBehavior_IsSurfableInSeafoamIslands(x: number, y: number): boolean {
  const f = avatarField();
  const mapId = f.mapId();
  if (mapId !== 'MAP_SEAFOAM_ISLANDS_B3F' && mapId !== 'MAP_SEAFOAM_ISLANDS_B4F') return false;
  return f.behaviors.isSurfable(f.behaviorAt(x, y));
}

/** `special DoFallWarp` (EventScript_DoFallWarp), registered with the field moves. */
export function registerFallWarp(): void {
  registerSpecials({
    DoFallWarp({ endScript }) {
      DoFallWarp();
      endScript();
    },
  });
}
