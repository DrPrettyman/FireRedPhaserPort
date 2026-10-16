import { OPPOSITE, type Direction } from './direction';

/**
 * Metatile behavior predicates (src/metatile_behavior.c). Behavior ids are read from the
 * extracted constants so we never hardcode numbers that could drift from the decomp.
 */
export class Behaviors {
  private ids: Record<string, number>;

  constructor(ids: Record<string, number>) {
    this.ids = ids;
  }

  is(behavior: number, ...names: string[]): boolean {
    return names.some((n) => this.ids[`MB_${n}`] === behavior);
  }

  private id(name: string): number | undefined {
    return this.ids[`MB_${name}`];
  }

  /** MetatileBehavior_IsTallGrass */
  isTallGrass(behavior: number): boolean {
    return this.is(behavior, 'TALL_GRASS', 'CYCLING_ROAD_PULL_DOWN_GRASS');
  }

  /** MetatileBehavior_IsPokeGrass */
  isPokeGrass(behavior: number): boolean {
    return this.is(behavior, 'TALL_GRASS', 'CYCLING_ROAD_PULL_DOWN_GRASS');
  }

  /** MetatileBehavior_IsReflective */
  isReflective(behavior: number): boolean {
    return this.is(behavior, 'POND_WATER', 'PUDDLE', 'UNUSED_WATER', 'CYCLING_ROAD_WATER', 'ICE');
  }

  /** MetatileBehavior_IsIce */
  isIce(behavior: number): boolean {
    return this.is(behavior, 'ICE');
  }

  /** MetatileBehavior_HasRipples */
  hasRipples(behavior: number): boolean {
    return this.is(behavior, 'POND_WATER', 'PUDDLE');
  }

  /** MetatileBehavior_IsPuddle */
  isPuddle(behavior: number): boolean {
    return this.is(behavior, 'PUDDLE');
  }

  /** MetatileBehavior_IsSand */
  isSand(behavior: number): boolean {
    return this.is(behavior, 'SAND', 'SAND_CAVE');
  }

  /** MetatileBehavior_IsShallowFlowingWater */
  isShallowFlowingWater(behavior: number): boolean {
    return this.is(behavior, 'SHALLOW_WATER');
  }

  /** MetatileBehavior_IsHotSprings */
  isHotSprings(behavior: number): boolean {
    return this.is(behavior, 'HOT_SPRINGS');
  }

  /** MetatileBehavior_IsSeaweed */
  isSeaweed(behavior: number): boolean {
    return this.is(behavior, 'SEAWEED');
  }

  // FRLG stubs these out: they always return FALSE.
  /** MetatileBehavior_IsLongGrass */
  isLongGrass(_behavior: number): boolean {
    return false;
  }

  /** MetatileBehavior_IsDeepSand */
  isDeepSand(_behavior: number): boolean {
    return false;
  }

  /** MetatileBehavior_IsFootprints */
  isFootprints(_behavior: number): boolean {
    return false;
  }

  /** MetatileBehavior_IsShortGrass */
  isShortGrass(_behavior: number): boolean {
    return false;
  }

  /** MetatileBehavior_IsPacifidlogLog */
  isPacifidlogLog(_behavior: number): boolean {
    return false;
  }

  /** MetatileBehavior_IsSandOrShallowFlowingWater */
  isSandOrShallowFlowingWater(behavior: number): boolean {
    return this.is(behavior, 'SAND', 'SHALLOW_WATER');
  }

  /** MetatileBehavior_IsIndoorEncounter */
  isIndoorEncounter(behavior: number): boolean {
    return this.is(behavior, 'INDOOR_ENCOUNTER');
  }

  /** MetatileBehavior_IsSurfable (sBehaviorSurfable) */
  isSurfable(behavior: number): boolean {
    return this.is(behavior, 'POND_WATER', 'FAST_WATER', 'DEEP_WATER', 'WATERFALL', 'OCEAN_WATER', 'UNUSED_WATER', 'CYCLING_ROAD_WATER', 'EASTWARD_CURRENT', 'WESTWARD_CURRENT', 'NORTHWARD_CURRENT', 'SOUTHWARD_CURRENT');
  }

  /** MetatileBehavior_IsDeepWaterTerrain */
  isDeepWaterTerrain(behavior: number): boolean {
    const fast = this.id('FAST_WATER');
    const deep = this.id('DEEP_WATER');
    return (fast !== undefined && deep !== undefined && behavior >= fast && behavior <= deep) || this.is(behavior, 'OCEAN_WATER');
  }

  /** MetatileBehavior_IsMountain */
  isMountain(behavior: number): boolean {
    return this.is(behavior, 'MOUNTAIN_TOP');
  }

  /** Ledge that can be jumped when moving in `dir`. */
  isJump(behavior: number, dir: Direction): boolean {
    return this.is(behavior, `JUMP_${COMPASS[dir]}`);
  }

  isAnyJump(behavior: number): boolean {
    return this.is(behavior, 'JUMP_EAST', 'JUMP_WEST', 'JUMP_NORTH', 'JUMP_SOUTH');
  }

  /** MetatileBehavior_IsForcedMovementTile */
  isForcedMovementTile(behavior: number): boolean {
    const inRange = (lo: string, hi: string) => behavior >= (this.id(lo) ?? Infinity) && behavior <= (this.id(hi) ?? -Infinity);
    return inRange('WALK_EAST', 'TRICK_HOUSE_PUZZLE_8_FLOOR') || inRange('EASTWARD_CURRENT', 'SOUTHWARD_CURRENT') || this.is(behavior, 'WATERFALL', 'ICE') || inRange('SPIN_RIGHT', 'SPIN_DOWN');
  }

  /** MetatileBehavior_IsSpinTile */
  isSpinTile(behavior: number): boolean {
    return behavior >= (this.id('SPIN_RIGHT') ?? Infinity) && behavior <= (this.id('SPIN_DOWN') ?? -Infinity);
  }

  /** MetatileBehavior_IsCyclingRoadPullDownTile */
  isCyclingRoadPullDownTile(behavior: number): boolean {
    return behavior >= (this.id('CYCLING_ROAD_PULL_DOWN') ?? Infinity) && behavior <= (this.id('CYCLING_ROAD_PULL_DOWN_GRASS') ?? -Infinity);
  }

  /** IsDirectionalStairWarpMetatileBehavior (field_control_avatar.c) */
  isDirectionalStairWarp(behavior: number, dir: Direction): boolean {
    if (dir === 'left') return this.is(behavior, 'UP_LEFT_STAIR_WARP', 'DOWN_LEFT_STAIR_WARP');
    if (dir === 'right') return this.is(behavior, 'UP_RIGHT_STAIR_WARP', 'DOWN_RIGHT_STAIR_WARP');
    return false;
  }

  /** IsMetatileDirectionallyImpassable: can't leave `from` across edge `dir`, or enter `to` across the opposite edge. */
  blocksMove(from: number, to: number, dir: Direction): boolean {
    return this.blocksEdge(from, dir) || this.blocksEdge(to, OPPOSITE[dir]);
  }

  private blocksEdge(behavior: number, edge: Direction): boolean {
    const c = COMPASS[edge];
    if (edge === 'up' || edge === 'down') return this.is(behavior, `IMPASSABLE_${c}`, `IMPASSABLE_${c}EAST`, `IMPASSABLE_${c}WEST`);
    return this.is(behavior, `IMPASSABLE_${c}`, `IMPASSABLE_NORTH${c}`, `IMPASSABLE_SOUTH${c}`);
  }

  /** IsWarpMetatileBehavior: warps that fire as soon as you step onto them. */
  isStepWarp(behavior: number): boolean {
    return this.is(behavior, 'WARP_DOOR', 'LADDER', 'UP_ESCALATOR', 'DOWN_ESCALATOR', 'CAVE_DOOR', 'REGULAR_WARP', 'FALL_WARP', 'UNION_ROOM_WARP', 'LAVARIDGE_1F_WARP');
  }

  isDoor(behavior: number): boolean {
    return this.is(behavior, 'WARP_DOOR');
  }

  /** Arrow warps and directional stair warps fire when pushing `dir` while standing on them. */
  isPushWarp(behavior: number, dir: Direction): boolean {
    if (this.is(behavior, `${COMPASS[dir]}_ARROW_WARP`)) return true;
    if (dir === 'left') return this.is(behavior, 'UP_LEFT_STAIR_WARP', 'DOWN_LEFT_STAIR_WARP');
    if (dir === 'right') return this.is(behavior, 'UP_RIGHT_STAIR_WARP', 'DOWN_RIGHT_STAIR_WARP');
    return false;
  }
}

const COMPASS: Record<Direction, string> = { up: 'NORTH', down: 'SOUTH', left: 'WEST', right: 'EAST' };
