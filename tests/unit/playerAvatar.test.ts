// field_player_avatar.c / overworld.c logic that doesn't need a field: the movement action table and the
// avatar state a warp carries (Store/GetInitialPlayerAvatarState).

import { beforeAll, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { directionalAction, heldActionSpec, movementActionName } from '../../src/entities/movementActions';
import { Behaviors } from '../../src/world/behaviors';
import {
  GetInitialPlayerAvatarState,
  gPlayerAvatar,
  ResetInitialPlayerAvatarState,
  setPlayerAvatarHost,
  StoreInitialPlayerAvatarState,
  type PlayerAvatarHost,
} from '../../src/world/playerAvatar';
import { readGen } from './gameData';

const defines = readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines;
const mb = readGen<{ metatileBehaviors: Record<string, number> }>('constants.json').metatileBehaviors;
const d = (name: string) => defines[name];

beforeAll(() => initConstants(defines));

describe('movement actions', () => {
  test('Get*MovementAction builds the decomp ids', () => {
    expect(directionalAction('WALK_NORMAL', 'up')).toBe(d('MOVEMENT_ACTION_WALK_NORMAL_UP'));
    expect(directionalAction('PLAYER_RUN_SLOW', 'left')).toBe(d('MOVEMENT_ACTION_PLAYER_RUN_LEFT_SLOW'));
    expect(directionalAction('FACE', 'right')).toBe(d('MOVEMENT_ACTION_FACE_RIGHT'));
  });

  test('held actions map onto steps, jumps, in-place anims, faces and delays', () => {
    expect(heldActionSpec(d('MOVEMENT_ACTION_WALK_NORMAL_DOWN'))).toEqual({ type: 'move', dir: 'down', kind: 'walk' });
    expect(heldActionSpec(d('MOVEMENT_ACTION_RIDE_WATER_CURRENT_LEFT'))).toEqual({ type: 'move', dir: 'left', kind: 'fast2' });
    expect(heldActionSpec(d('MOVEMENT_ACTION_JUMP_2_DOWN'))).toEqual({ type: 'move', dir: 'down', kind: 'jump' });
    expect(heldActionSpec(d('MOVEMENT_ACTION_JUMP_SPECIAL_WITH_EFFECT_UP'))).toEqual({ type: 'move', dir: 'up', kind: 'jumpSpecial' });
    expect(heldActionSpec(d('MOVEMENT_ACTION_WALK_IN_PLACE_SLOW_RIGHT'))).toEqual({ type: 'move', dir: 'right', kind: 'inPlaceSlow', inPlace: true });
    expect(heldActionSpec(d('MOVEMENT_ACTION_WALK_IN_PLACE_FAST_UP'))).toEqual({ type: 'move', dir: 'up', kind: 'inPlaceFast', inPlace: true });
    expect(heldActionSpec(d('MOVEMENT_ACTION_SPIN_DOWN'))).toEqual({ type: 'move', dir: 'down', kind: 'spin' });
    expect(heldActionSpec(d('MOVEMENT_ACTION_PLAYER_RUN_UP_SLOW'))).toEqual({ type: 'move', dir: 'up', kind: 'runSlow' });
    expect(heldActionSpec(d('MOVEMENT_ACTION_FACE_LEFT_FAST'))).toEqual({ type: 'face', dir: 'left' });
    expect(heldActionSpec(d('MOVEMENT_ACTION_DELAY_8'))).toEqual({ type: 'delay', frames: 8 });
    expect(movementActionName(d('MOVEMENT_ACTION_WALK_FAST_RIGHT'))).toBe('WALK_FAST_RIGHT');
  });
});

describe('the avatar state across a warp', () => {
  let allowCycling = true;
  let mapId = 'MAP_ROUTE1';
  const flags = new Set<string>();
  const player = { facing: 'left', movementDirection: 'left' };

  beforeAll(() => {
    setPlayerAvatarHost({ player, behaviors: new Behaviors(mb), allowCycling: () => allowCycling, mapId: () => mapId, flag: (n: string) => flags.has(n) } as unknown as PlayerAvatarHost);
  });

  const initial = (behavior: string, mapType = 'MAP_TYPE_ROUTE') => GetInitialPlayerAvatarState(d(mapType), mb[behavior], mapId);

  test('the bike carries over where biking is allowed', () => {
    gPlayerAvatar.flags = d('PLAYER_AVATAR_FLAG_MACH_BIKE');
    StoreInitialPlayerAvatarState();
    expect(initial('MB_NORMAL').transitionFlags).toBe(d('PLAYER_AVATAR_FLAG_MACH_BIKE'));
    allowCycling = false;
    StoreInitialPlayerAvatarState();
    expect(initial('MB_NORMAL').transitionFlags).toBe(d('PLAYER_AVATAR_FLAG_ON_FOOT'));
    allowCycling = true;
  });

  test('arriving on water surfs, except in Seafoam B3F/B4F', () => {
    gPlayerAvatar.flags = d('PLAYER_AVATAR_FLAG_ON_FOOT');
    StoreInitialPlayerAvatarState();
    expect(initial('MB_POND_WATER').transitionFlags).toBe(d('PLAYER_AVATAR_FLAG_SURFING'));
    mapId = 'MAP_SEAFOAM_ISLANDS_B4F';
    StoreInitialPlayerAvatarState();
    expect(initial('MB_POND_WATER').transitionFlags).toBe(d('PLAYER_AVATAR_FLAG_ON_FOOT'));
    mapId = 'MAP_ROUTE1';
  });

  test('the arrival tile picks the facing; otherwise south', () => {
    StoreInitialPlayerAvatarState();
    expect(initial('MB_WARP_DOOR').direction).toBe('down');
    StoreInitialPlayerAvatarState();
    expect(initial('MB_SOUTH_ARROW_WARP').direction).toBe('up');
    StoreInitialPlayerAvatarState();
    expect(initial('MB_LADDER').direction).toBe('left'); // kept from before the warp
    StoreInitialPlayerAvatarState();
    expect(initial('MB_NORMAL').direction).toBe('down');
    ResetInitialPlayerAvatarState();
    expect(initial('MB_NORMAL')).toEqual({ transitionFlags: d('PLAYER_AVATAR_FLAG_ON_FOOT'), direction: 'down' });
  });
});
