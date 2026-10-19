// field_specials.c's quest log half: sInsideOutsidePairs (questLog.json, by QL_LOCATION_*),
// QuestLog_CheckDepartingIndoorsMap and QuestLog_TryRecordDepartedLocation, which DoMapLoadLoop runs after every
// warp's map load (OverworldScene.onMapLoaded): entering one of the listed buildings, caves or gates remembers it
// (VAR_QL_ENTRANCE, FLAG_SYS_QL_DEPARTED); arriving at its outside map records QL_EVENT_DEPARTED.

import { K } from '../battle/constants';
import { MAP_OFFSET, questLogData, questLogHost } from './questLog';
import { SetQuestLogEvent } from './questLogEvents';

/** The MAPSEC_* number of a map (Overworld_GetMapHeaderByGroupAndId(...)->regionMapSectionId). */
export function mapSecOf(mapId: string): number {
  return K[questLogData().maps[mapId]?.[2] ?? 'MAPSEC_NONE'];
}

/** QuestLog_CheckDepartingIndoorsMap: the player is inside one of sInsideOutsidePairs' maps. */
export function QuestLog_CheckDepartingIndoorsMap(): void {
  const host = questLogHost();
  if (!host) return;
  const state = host.state;
  const mapId = host.location().mapId;
  const pairs = questLogData().insideOutsidePairs;
  for (let i = 0; i < pairs.length; i++) {
    if (mapId === pairs[i][0]) {
      // Coming back up from the Rocket Hideout keeps it as the place the Game Corner's exit will report
      if (state.getVar(K.VAR_QL_ENTRANCE) !== K.QL_LOCATION_ROCKET_HIDEOUT || i !== K.QL_LOCATION_GAME_CORNER) {
        state.setVar(K.VAR_QL_ENTRANCE, i);
        state.setFlag(K.FLAG_SYS_QL_DEPARTED);
      }
      break;
    }
  }
}

/** QuestLog_TryRecordDepartedLocation: the player came out of the remembered place. */
export function QuestLog_TryRecordDepartedLocation(): void {
  const host = questLogHost();
  if (!host) return;
  const state = host.state;
  const pairs = questLogData().insideOutsidePairs;
  const locationId = state.getVar(K.VAR_QL_ENTRANCE);
  const loc = host.location();
  const data = { mapSec: 0, locationId: 0 };
  if (!state.getFlag(K.FLAG_SYS_QL_DEPARTED)) return;
  if (locationId === K.QL_LOCATION_VIRIDIAN_FOREST_1) {
    // Viridian Forest's two gates (both in the Route 2 gates' group)
    if (loc.mapId === 'MAP_ROUTE2_VIRIDIAN_FOREST_SOUTH_ENTRANCE' || loc.mapId === 'MAP_ROUTE2_VIRIDIAN_FOREST_NORTH_ENTRANCE') {
      data.mapSec = K.MAPSEC_ROUTE_2;
      data.locationId = loc.mapId === 'MAP_ROUTE2_VIRIDIAN_FOREST_SOUTH_ENTRANCE' ? locationId : locationId + 1;
      SetQuestLogEvent(K.QL_EVENT_DEPARTED, data);
      state.setFlag(K.FLAG_SYS_QL_DEPARTED, false);
      return;
    }
  } else if (locationId === K.QL_LOCATION_LEAGUE_GATE_1) {
    if (loc.mapId === 'MAP_ROUTE22' || loc.mapId === 'MAP_ROUTE23') {
      data.mapSec = mapSecOf(pairs[locationId][0]);
      data.locationId = loc.mapId === 'MAP_ROUTE22' ? locationId : locationId + 1;
      SetQuestLogEvent(K.QL_EVENT_DEPARTED, data);
      state.setFlag(K.FLAG_SYS_QL_DEPARTED, false);
      return;
    }
  }
  if (loc.mapId === pairs[locationId]?.[1]) {
    data.mapSec = mapSecOf(pairs[locationId][0]);
    data.locationId = locationId;
    // PlayerGetDestCoords (map coordinates): Rock Tunnel's and the Seafoam Islands' other exit
    const x = loc.x + MAP_OFFSET;
    const y = loc.y + MAP_OFFSET;
    if (locationId === K.QL_LOCATION_ROCK_TUNNEL_1) {
      if (x !== 15 || y !== 26) data.locationId++;
    } else if (locationId === K.QL_LOCATION_SEAFOAM_ISLANDS_1) {
      if (x !== 67 || y !== 15) data.locationId++;
    }
    SetQuestLogEvent(K.QL_EVENT_DEPARTED, data);
    state.setFlag(K.FLAG_SYS_QL_DEPARTED, false);
    if (locationId === K.QL_LOCATION_ROCKET_HIDEOUT) {
      // out of the hideout into the Game Corner: leaving that is next
      state.setVar(K.VAR_QL_ENTRANCE, K.QL_LOCATION_GAME_CORNER);
      state.setFlag(K.FLAG_SYS_QL_DEPARTED);
    }
  }
}
