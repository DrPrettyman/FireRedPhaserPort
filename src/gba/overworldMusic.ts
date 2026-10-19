// overworld.c's map music block (overworld.c:989-1200): which song a map plays (the header's, or
// gSaveBlock1Ptr->savedMusic, or MUS_SURF while surfing), the warps' fade-out (TryFadeOutOldMapMusic) and the
// connections' transition, on top of sound.c's map music state machine (gba/sound.ts: PlayNewMapMusic,
// FadeOutMapMusic, MapMusicMain). BGMusicStopped and Overworld_ChangeMusicTo stay in sound.ts (one-line wrappers that
// sound.c's tests already use); gDisableMapMusicChangeOnMapLoad lives there too, since PlaySE reads it.
//
// The C reads gMapHeader / gSaveBlock1Ptr->location and sWarpDestination. The port's field (OverworldScene) gives the
// current map through the host; a warp's destination header is passed in (the port loads it before the warp's fade).

import { K } from '../battle/constants';
import { gMPlayInfo_BGM, gSongTable } from '../audio/m4a';
import type { MapData } from '../data/types';
import type { GameState } from '../state/GameState';
import { gPlayerAvatar, PLAYER_AVATAR_FLAG } from '../world/playerAvatar';
import {
  FadeInBGM,
  FadeOutAndFadeInNewMapMusic,
  FadeOutAndPlayNewMapMusic,
  FadeOutMapMusic,
  gDisableMapMusicChangeOnMapLoad,
  GetCurrentMapMusic,
  MUSIC_DISABLE_KEEP,
  MUSIC_DISABLE_STOP,
  PlayNewMapMusic,
  ResetMapMusic,
  StopMapMusic,
} from './sound';

/** What the music reads from a map header: gMapHeader.music, mapType and regionMapSectionId (and the map's id). */
export type MapMusicHeader = Pick<MapData, 'id' | 'music' | 'mapType' | 'regionMapSection'>;

/** What the map music needs from the field. Implemented by OverworldScene. */
export interface OverworldMusicHost {
  /** gSaveBlock1Ptr (savedMusic, the flags) */
  state: GameState;
  /** gMapHeader, the header of gSaveBlock1Ptr->location's map */
  currentMap(): MapMusicHeader;
  /** PlayerGetDestCoords, map-local (gSaveBlock1Ptr->pos) */
  playerLocal(): { x: number; y: number };
}

let host: OverworldMusicHost | undefined;

export function setOverworldMusicHost(h: OverworldMusicHost | undefined): void {
  host = h;
}

/** Whether a field host is set: battle-test.html has none, so there's no map music to go back to there. */
export function hasOverworldMusicHost(): boolean {
  return host !== undefined;
}

function musicHost(): OverworldMusicHost {
  if (!host) throw new Error('[map music] no field host');
  return host;
}

function TestPlayerAvatarFlags(flags: number): boolean {
  return (gPlayerAvatar.flags & flags) !== 0;
}

/** GetLocationMusic: a header's music as a song id (a header without music plays MUS_DUMMY). */
export function GetLocationMusic(header: MapMusicHeader): number {
  return header.music ? K[header.music] : 0;
}

/** GetCurrLocationDefaultMusic: the current map's header music (not savedMusic, not surf). */
export function GetCurrLocationDefaultMusic(): number {
  return GetLocationMusic(musicHost().currentMap());
}

/** GetWarpDestinationMusic: the warp destination header's music (sWarpDestination, passed in). */
export function GetWarpDestinationMusic(dest: MapMusicHeader): number {
  return GetLocationMusic(dest);
}

export function Overworld_ResetMapMusic(): void {
  ResetMapMusic();
}

/**
 * Overworld_PlaySpecialMapMusic: on a map load (the warps' and screens' field callbacks, CONTINUE, getting off the
 * bike). savedMusic if set, else MUS_SURF while surfing (where it may override), else the map's music; a new song
 * only if it isn't already the map music. In the Champion's room after the battle (the victory music still on the
 * BGM player), the music fades back in instead.
 */
export function Overworld_PlaySpecialMapMusic(): void {
  if (gDisableMapMusicChangeOnMapLoad === MUSIC_DISABLE_STOP) {
    StopMapMusic();
    return;
  }
  if (gDisableMapMusicChangeOnMapLoad === MUSIC_DISABLE_KEEP) return;

  const h = musicHost();
  if (h.currentMap().id === 'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM') {
    // PlayerGetDestCoords: y - 7 (MAP_OFFSET) is the map-local y
    const { y } = h.playerLocal();
    if (y < 11 && gMPlayInfo_BGM.songHeader && gMPlayInfo_BGM.songHeader === gSongTable[K.MUS_VICTORY_GYM_LEADER]?.header) {
      FadeInBGM(4);
      return;
    }
  }

  let music = GetCurrLocationDefaultMusic();
  if (h.state.savedMusic) music = h.state.savedMusic;
  else if (TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.SURFING) && Overworld_MusicCanOverrideMapMusic(K.MUS_SURF)) music = K.MUS_SURF;

  if (music !== GetCurrentMapMusic()) PlayNewMapMusic(music);
}

/** Overworld_SetSavedMusic: `savebgm`, `playbgm` with its save flag, the bike, Cycling Road. Saved in the save file. */
export function Overworld_SetSavedMusic(songNum: number): void {
  musicHost().state.savedMusic = songNum & 0xffff;
}

/** Overworld_ClearSavedMusic: every map load (LoadMapFromWarp / LoadMapFromCameraTransition), off the bike, surfing. */
export function Overworld_ClearSavedMusic(): void {
  musicHost().state.savedMusic = 0;
}

/**
 * Overworld_TryMapConnectionMusicTransition (LoadMapFromCameraTransition, before the new map is loaded, so
 * Overworld_MusicCanOverrideMapMusic still reads the old map's section): fade to the new map's music at speed 8, or
 * crossfade (4 out, 4 in) on the bike. MUS_SURF keeps playing.
 */
export function Overworld_TryMapConnectionMusicTransition(dest: MapMusicHeader): void {
  if (gDisableMapMusicChangeOnMapLoad === MUSIC_DISABLE_STOP) {
    StopMapMusic();
    return;
  }
  if (gDisableMapMusicChangeOnMapLoad === MUSIC_DISABLE_KEEP) return;

  if (musicHost().state.getFlag('FLAG_DONT_TRANSITION_MUSIC')) return;
  let newMusic = GetWarpDestinationMusic(dest);
  const currentMusic = GetCurrentMapMusic();
  if (currentMusic === K.MUS_SURF) return;
  if (TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.SURFING) && Overworld_MusicCanOverrideMapMusic(K.MUS_SURF)) newMusic = K.MUS_SURF;
  if (newMusic !== currentMusic) {
    if (TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.MACH_BIKE | PLAYER_AVATAR_FLAG.ACRO_BIKE)) FadeOutAndFadeInNewMapMusic(newMusic, 4, 4);
    else FadeOutAndPlayNewMapMusic(newMusic, 8);
  }
}

/** Overworld_ChangeMusicToDefault: `fadedefaultbgm`, getting off the surfing mon: fade to the map's own music. */
export function Overworld_ChangeMusicToDefault(): void {
  const currentMusic = GetCurrentMapMusic();
  if (currentMusic !== GetCurrLocationDefaultMusic()) FadeOutAndPlayNewMapMusic(GetCurrLocationDefaultMusic(), 8);
}

/** IsMapTypeIndoors (overworld.c) */
function IsMapTypeIndoors(mapType: string | null): boolean {
  return mapType === 'MAP_TYPE_INDOOR' || mapType === 'MAP_TYPE_SECRET_BASE';
}

/** GetMapMusicFadeoutSpeed: 2 into an indoor map (32 frames), else 4 (64 frames). */
export function GetMapMusicFadeoutSpeed(dest: MapMusicHeader): number {
  return IsMapTypeIndoors(dest.mapType) ? 2 : 4;
}

/**
 * TryFadeOutOldMapMusic: before a warp, fade the map music out unless the destination plays the same song (or
 * FLAG_DONT_TRANSITION_MUSIC is set). The warp tasks then wait for BGMusicStopped as well as the screen's fade.
 */
export function TryFadeOutOldMapMusic(dest: MapMusicHeader): void {
  const warpMusic = GetWarpDestinationMusic(dest);
  if (!musicHost().state.getFlag('FLAG_DONT_TRANSITION_MUSIC') && warpMusic !== GetCurrentMapMusic()) {
    FadeOutMapMusic(GetMapMusicFadeoutSpeed(dest));
  }
}

/** Overworld_FadeOutMapMusic: the Seagallop ferry, `special Script_FadeOutMapMusic`. */
export function Overworld_FadeOutMapMusic(): void {
  FadeOutMapMusic(4);
}

/** Overworld_MusicCanOverrideMapMusic: the bike's and surf music don't play on Victory Road, Route 23 or the Indigo Plateau. */
export function Overworld_MusicCanOverrideMapMusic(music: number): boolean {
  if (music === K.MUS_CYCLING || music === K.MUS_SURF) {
    const mapsec = musicHost().currentMap().regionMapSection;
    if (mapsec === 'MAPSEC_KANTO_VICTORY_ROAD' || mapsec === 'MAPSEC_ROUTE_23' || mapsec === 'MAPSEC_INDIGO_PLATEAU') return false;
  }
  return true;
}
