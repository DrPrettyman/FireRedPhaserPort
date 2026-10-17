// itemfinder.c's search for hidden items (HiddenItemIsWithinRangeOfPlayer and the connected maps' search) and
// the direction the response points, without the field: world/itemfinder.ts runs it on the current map, unit
// tests on map JSON. Coordinates are the C's: map-local plus MAP_OFFSET (7), as PlayerGetDestCoords and
// GetMapConnectionAtPos use them.

import type { BgEventData, MapConnection, MapData } from '../data/types';

const MAP_OFFSET = 7;

// DIR_* (GetPlayerDirectionTowardsHiddenItem's return values)
export const DIR_NONE = 0;
export const DIR_SOUTH = 1;
export const DIR_NORTH = 2;
export const DIR_WEST = 3;
export const DIR_EAST = 4;

type MapHeader = Pick<MapData, 'width' | 'height' | 'bgEvents' | 'connections'>;

export interface HiddenItemSearchEnv {
  /** gMapHeader */
  map: MapHeader;
  /** GetMapHeaderFromConnection (the connected maps' headers; undefined if not loaded) */
  mapHeader(mapId: string): MapHeader | undefined;
  /** PlayerGetDestCoords, map-local (without MAP_OFFSET) */
  player: { x: number; y: number };
  /** FlagGet of a hidden item's flag (FLAG_HIDDEN_ITEM_*) */
  flagGet(flag: string): boolean;
}

/** The Itemfinder task's data the search fills (tItemX, tItemY, tHiddenItemFound, tNumDingsRemaining, tUnderfoot). */
export interface ItemfinderSearch {
  tItemX: number;
  tItemY: number;
  tHiddenItemFound: boolean;
  tNumDingsRemaining: number;
  tUnderfoot: boolean;
  /** SetUnderfootHiddenItem's hidden item (its flag and item go into VAR_0x8004 / VAR_0x8005) */
  underfootItem?: BgEventData;
}

export function newItemfinderSearch(): ItemfinderSearch {
  return { tItemX: 0, tItemY: 0, tHiddenItemFound: false, tNumDingsRemaining: 0, tUnderfoot: false };
}

const isHiddenItem = (e: BgEventData) => e.type === 'hidden_item'; // kind == BG_EVENT_HIDDEN_ITEM (7)
const flagOf = (e: BgEventData) => String(e.flag); // GetHiddenItemAttr(HIDDEN_ITEM_FLAG)
const isUnderfoot = (e: BgEventData) => !!e.underfoot; // GetHiddenItemAttr(HIDDEN_ITEM_UNDERFOOT)

/** HiddenItemIsWithinRangeOfPlayer */
export function HiddenItemIsWithinRangeOfPlayer(env: HiddenItemSearchEnv, data: ItemfinderSearch): boolean {
  const x = env.player.x + MAP_OFFSET;
  const y = env.player.y + MAP_OFFSET;
  data.tHiddenItemFound = false;
  for (const e of env.map.bgEvents) {
    if (isHiddenItem(e) && !env.flagGet(flagOf(e))) {
      const dx = e.x + MAP_OFFSET - x;
      const dy = e.y + MAP_OFFSET - y;
      if (isUnderfoot(e)) {
        if (dx === 0 && dy === 0) {
          SetUnderfootHiddenItem(data, e);
          return true;
        }
      } else if (dx >= -7 && dx <= 7 && dy >= -5 && dy <= 5) {
        RegisterHiddenItemRelativeCoordsIfCloser(data, dx, dy);
      }
    }
  }
  FindHiddenItemsInConnectedMaps(env, data);
  if (data.tHiddenItemFound) {
    SetNormalHiddenItem(data);
    return true;
  }
  return false;
}

/** SetUnderfootHiddenItem (the special vars and TV_PrintIntToStringVar are the field's: world/itemfinder.ts) */
function SetUnderfootHiddenItem(data: ItemfinderSearch, e: BgEventData): void {
  data.underfootItem = e;
  data.tHiddenItemFound = true;
  data.tItemX = 0;
  data.tItemY = 0;
  data.tNumDingsRemaining = 3;
  data.tUnderfoot = true;
}

/** SetNormalHiddenItem: the response is stronger (4 dings, not 2) within 3 tiles along the longer axis. */
function SetNormalHiddenItem(data: ItemfinderSearch): void {
  if (data.tItemX === 0 && data.tItemY === 0) {
    data.tNumDingsRemaining = 4;
  } else {
    const absX = Math.abs(data.tItemX);
    const absY = Math.abs(data.tItemY);
    if (absX > absY) data.tNumDingsRemaining = absX > 3 ? 2 : 4;
    else data.tNumDingsRemaining = absY > 3 ? 2 : 4;
  }
}

/** HiddenItemAtPos: the first hidden item bg event there, if it isn't underfoot or picked up. */
function HiddenItemAtPos(env: HiddenItemSearchEnv, events: BgEventData[], x: number, y: number): boolean {
  for (const e of events) {
    if (isHiddenItem(e) && x === e.x && y === e.y) return !isUnderfoot(e) && !env.flagGet(flagOf(e));
  }
  return false;
}

/** HiddenItemInConnectedMapAtPos: (x, y) in the connected map's coordinates. */
function HiddenItemInConnectedMapAtPos(env: HiddenItemSearchEnv, connection: MapConnection, mapHeader: MapHeader, x: number, y: number): boolean {
  let localX: number;
  let localY: number;
  switch (connection.direction) {
    case 'up':
      localX = x - (connection.offset + MAP_OFFSET);
      localY = mapHeader.height - MAP_OFFSET + y;
      break;
    case 'down':
      localX = x - (connection.offset + MAP_OFFSET);
      localY = y - (env.map.height + MAP_OFFSET);
      break;
    case 'left':
      localX = mapHeader.width - MAP_OFFSET + x;
      localY = y - (connection.offset + MAP_OFFSET);
      break;
    case 'right':
      localX = x - (env.map.width + MAP_OFFSET);
      localY = y - (connection.offset + MAP_OFFSET);
      break;
    default:
      return false;
  }
  // (localX / localY are u16 in the C: off-map values wrap and match nothing, as negative ones do here)
  return HiddenItemAtPos(env, mapHeader.bgEvents, localX, localY);
}

/** fieldmap.c's GetMapConnectionAtPos, with the connection's header (GetMapHeaderFromConnection). */
function GetMapConnectionAtPos(env: HiddenItemSearchEnv, x: number, y: number): { connection: MapConnection; header: MapHeader } | undefined {
  const map = env.map;
  for (const connection of map.connections) {
    const direction = connection.direction;
    if (
      direction === 'dive' ||
      direction === 'emerge' ||
      (direction === 'up' && y > MAP_OFFSET - 1) ||
      (direction === 'down' && y < map.height + MAP_OFFSET) ||
      (direction === 'left' && x > MAP_OFFSET - 1) ||
      (direction === 'right' && x < map.width + MAP_OFFSET)
    ) {
      continue;
    }
    const header = env.mapHeader(connection.map);
    if (header && IsPosInConnectingMap(connection, header, x - MAP_OFFSET, y - MAP_OFFSET)) return { connection, header };
  }
  return undefined;
}

/** fieldmap.c's IsPosInConnectingMap */
function IsPosInConnectingMap(connection: MapConnection, header: MapHeader, x: number, y: number): boolean {
  switch (connection.direction) {
    case 'down':
    case 'up':
      return x - connection.offset >= 0 && x - connection.offset < header.width;
    case 'left':
    case 'right':
      return y - connection.offset >= 0 && y - connection.offset < header.height;
  }
  return false;
}

/** FindHiddenItemsInConnectedMaps: the tiles in range that are off the current map's grid. */
function FindHiddenItemsInConnectedMaps(env: HiddenItemSearchEnv, data: ItemfinderSearch): void {
  const width = env.map.width + MAP_OFFSET;
  const height = env.map.height + MAP_OFFSET;
  const x = env.player.x + MAP_OFFSET;
  const y = env.player.y + MAP_OFFSET;
  for (let curX = x - 7; curX <= x + 7; curX++) {
    for (let curY = y - 5; curY <= y + 5; curY++) {
      if (MAP_OFFSET > curX || curX >= width || MAP_OFFSET > curY || curY >= height) {
        const conn = GetMapConnectionAtPos(env, curX, curY);
        if (conn && HiddenItemInConnectedMapAtPos(env, conn.connection, conn.header, curX, curY)) {
          RegisterHiddenItemRelativeCoordsIfCloser(data, curX - x, curY - y);
        }
      }
    }
  }
}

/**
 * RegisterHiddenItemRelativeCoordsIfCloser: keep the closest item (Manhattan distance); on a tie, the one with
 * the smaller vertical distance, then the one further south.
 */
export function RegisterHiddenItemRelativeCoordsIfCloser(data: ItemfinderSearch, dx: number, dy: number): void {
  if (!data.tHiddenItemFound) {
    data.tItemX = dx;
    data.tItemY = dy;
    data.tHiddenItemFound = true;
    return;
  }
  const dx2 = Math.abs(data.tItemX);
  const dy2 = Math.abs(data.tItemY);
  const dx3 = Math.abs(dx);
  const dy3 = Math.abs(dy);
  if (dx2 + dy2 > dx3 + dy3) {
    data.tItemX = dx;
    data.tItemY = dy;
  } else if (dx2 + dy2 === dx3 + dy3 && (dy2 > dy3 || (dy2 === dy3 && data.tItemY < dy))) {
    data.tItemX = dx;
    data.tItemY = dy;
  }
}

/**
 * GetPlayerDirectionTowardsHiddenItem. The names don't say where the item is: CreateArrowSprite reads DIR_EAST as
 * "the item is to the left" (the arrows move left), DIR_NORTH as right, DIR_SOUTH as up and DIR_WEST as down;
 * DIR_NONE (on the item) points the way the player faces.
 */
export function GetPlayerDirectionTowardsHiddenItem(itemX: number, itemY: number): number {
  if (itemX === 0 && itemY === 0) return DIR_NONE; // standing on the item
  const abX = Math.abs(itemX);
  const abY = Math.abs(itemY);
  if (abX > abY) return itemX < 0 ? DIR_EAST : DIR_NORTH;
  return itemY < 0 ? DIR_SOUTH : DIR_WEST; // abX < abY, and abX == abY likewise
}
