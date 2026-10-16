// region_map.c's map section names, for the summary screen's met location and the field's map name popup.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { encodeRaw } from '../menus/common';
import { menusData } from '../menus/data';

const EOS = 0xff;
const CHAR_SPACE = 0x00;

/** IsCeladonDeptStoreMapsec: the player is in the department store (and the region map isn't open). */
function IsCeladonDeptStoreMapsec(mapsec: number): boolean {
  if (mapsec !== K.MAPSEC_CELADON_CITY) return false;
  return state.currentMap.startsWith('CeladonCity_DepartmentStore_');
}

/** GetMapName(dest, mapsec, fill): the section's name (encoded, with EOS), padded with spaces to `fill` chars. */
export function GetMapName(mapsec: number, fill = 0): number[] {
  const idx = mapsec - K.KANTO_MAPSEC_START;
  if (idx < 0 || idx >= K.MAPSEC_NONE - K.KANTO_MAPSEC_START) return [...Array(fill || 18).fill(CHAR_SPACE), EOS]; // StringFill
  // sMapsecName_CELADON_DEPT_ is MAPSEC_SPECIAL_AREA's name
  const name = IsCeladonDeptStoreMapsec(mapsec) ? menusData.mapsecNames[K.MAPSEC_SPECIAL_AREA - K.KANTO_MAPSEC_START]! : (menusData.mapsecNames[idx] ?? '$');
  const dst = encodeRaw(name);
  dst.pop(); // EOS
  while (dst.length < fill) dst.push(CHAR_SPACE);
  dst.push(EOS);
  return dst;
}

/** Region map sections of maps whose headers the field has loaded (Overworld_GetMapHeaderByGroupAndId(...)->regionMapSectionId). */
const mapSections = new Map<string, number>();

export function cacheMapSection(mapId: string, mapsec: number): void {
  mapSections.set(mapId, mapsec);
}

/** A cached map's region map section (MAPSEC_NONE if its header hasn't been loaded). */
export function GetMapSectionOfMap(mapId: string | undefined): number {
  return (mapId !== undefined ? mapSections.get(mapId) : undefined) ?? K.MAPSEC_NONE;
}
