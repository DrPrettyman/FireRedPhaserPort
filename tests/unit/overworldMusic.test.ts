// gba/overworldMusic.ts (overworld.c's map music block) on sound.c's state machine and the extracted songs: which song
// Overworld_PlaySpecialMapMusic picks (the header's, savedMusic, MUS_SURF and where it may not override), the warps'
// TryFadeOutOldMapMusic (32 frames indoors, 64 outdoors, none for the same song), the connections' transition (a fade
// on foot, a crossfade on the bike, MUS_SURF kept), gDisableMapMusicChangeOnMapLoad and PlaySE's gate. Expected
// numbers from overworld.c / sound.c and FadeOutBody's 16 × speed frames (tests/unit/m4a.test.ts).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { setVoiceData } from '../../src/audio/m4a';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';
import { AgbMainFrameEnd, AgbMainSoundInit } from '../../src/audio/frame';
import {
  BGMusicStopped,
  GetCurrentMapMusic,
  IsBGMStopped,
  MUSIC_DISABLE_KEEP,
  MUSIC_DISABLE_OFF,
  MUSIC_DISABLE_STOP,
  PlayBGM,
  PlayNewMapMusic,
  PlaySE,
  SetDisableMapMusicChangeOnMapLoad,
  setSoundEventListener,
  soundProbe,
  type SoundEvent,
} from '../../src/gba/sound';
import {
  GetCurrLocationDefaultMusic,
  Overworld_ChangeMusicToDefault,
  Overworld_ClearSavedMusic,
  Overworld_MusicCanOverrideMapMusic,
  Overworld_PlaySpecialMapMusic,
  Overworld_SetSavedMusic,
  Overworld_TryMapConnectionMusicTransition,
  setOverworldMusicHost,
  TryFadeOutOldMapMusic,
  type MapMusicHeader,
} from '../../src/gba/overworldMusic';
import { gPlayerAvatar, PLAYER_AVATAR_FLAG } from '../../src/world/playerAvatar';
import { newGame, readGen, type TestGame } from './gameData';

const SONGS_JSON = resolve(__dirname, '../../public/gen/audio/songs.json');
const defines = readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines;
const d = (name: string): number => defines[name];

const PALLET: MapMusicHeader = { id: 'MAP_PALLET_TOWN', music: 'MUS_PALLET', mapType: 'MAP_TYPE_TOWN', regionMapSection: 'MAPSEC_PALLET_TOWN' };
const ROUTE1: MapMusicHeader = { id: 'MAP_ROUTE1', music: 'MUS_ROUTE1', mapType: 'MAP_TYPE_ROUTE', regionMapSection: 'MAPSEC_ROUTE_1' };
const PLAYERS_HOUSE: MapMusicHeader = { id: 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', music: 'MUS_PALLET', mapType: 'MAP_TYPE_INDOOR', regionMapSection: 'MAPSEC_PALLET_TOWN' };
const OAKS_LAB: MapMusicHeader = { id: 'MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB', music: 'MUS_OAK_LAB', mapType: 'MAP_TYPE_INDOOR', regionMapSection: 'MAPSEC_PALLET_TOWN' };
const VICTORY_ROAD: MapMusicHeader = { id: 'MAP_VICTORY_ROAD_1F', music: 'MUS_VICTORY_ROAD', mapType: 'MAP_TYPE_UNDERGROUND', regionMapSection: 'MAPSEC_KANTO_VICTORY_ROAD' };

describe.skipIf(!existsSync(SONGS_JSON))('overworld.c map music on the extracted songs', () => {
  const json = existsSync(SONGS_JSON) ? (JSON.parse(readFileSync(SONGS_JSON, 'utf8')) as SongsJson) : null;
  const gen = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../public/gen/audio', f), 'utf8'));
  let t: TestGame;
  let current: MapMusicHeader;
  let local = { x: 5, y: 5 };

  beforeAll(() => {
    initConstants(defines);
    loadSongTable(json!);
    setVoiceData(gen('voicegroups.json'), gen('samples.json'), gen('waves.json'));
  });

  beforeEach(() => {
    t = newGame();
    current = PALLET;
    local = { x: 5, y: 5 };
    setOverworldMusicHost({ state: t.state, currentMap: () => current, playerLocal: () => local, getLocalWildMon: () => ({ species: 0, isWaterMon: false }), playerDestIsSurfable: () => false });
    AgbMainSoundInit();
    setSoundEventListener(undefined);
    gPlayerAvatar.flags = PLAYER_AVATAR_FLAG.ON_FOOT;
  });

  /** Frames (AgbMainFrameEnd calls) until cond holds, checked before each frame as the warp tasks do. */
  const framesUntil = (cond: () => boolean, cap = 5000): number => {
    for (let f = 0; f < cap; f++) {
      if (cond()) return f;
      AgbMainFrameEnd();
    }
    return -1;
  };

  /** The map's music, started and playing (a map load, then two frames). */
  const playMapMusic = (): void => {
    Overworld_PlaySpecialMapMusic();
    AgbMainFrameEnd();
    AgbMainFrameEnd();
  };

  test("Overworld_PlaySpecialMapMusic plays the header's music, savedMusic over it, MUS_SURF while surfing", () => {
    expect(GetCurrLocationDefaultMusic()).toBe(d('MUS_PALLET'));
    Overworld_PlaySpecialMapMusic();
    expect(GetCurrentMapMusic()).toBe(d('MUS_PALLET'));
    expect(soundProbe().mapMusic.state).toBe(1); // PlayNewMapMusic: MapMusicMain starts it at the frame's end

    Overworld_SetSavedMusic(d('MUS_CYCLING'));
    expect(t.state.savedMusic).toBe(d('MUS_CYCLING'));
    Overworld_PlaySpecialMapMusic();
    expect(GetCurrentMapMusic()).toBe(d('MUS_CYCLING'));
    // savedMusic wins over surfing too (the C checks it first)
    gPlayerAvatar.flags = PLAYER_AVATAR_FLAG.SURFING;
    Overworld_PlaySpecialMapMusic();
    expect(GetCurrentMapMusic()).toBe(d('MUS_CYCLING'));

    Overworld_ClearSavedMusic();
    expect(t.state.savedMusic).toBe(0);
    Overworld_PlaySpecialMapMusic();
    expect(GetCurrentMapMusic()).toBe(d('MUS_SURF'));
    // GetCurrLocationDefaultMusic is still the header's
    expect(GetCurrLocationDefaultMusic()).toBe(d('MUS_PALLET'));
  });

  test("surf and cycling music don't override on Victory Road, Route 23 or the Indigo Plateau", () => {
    expect(Overworld_MusicCanOverrideMapMusic(d('MUS_SURF'))).toBe(true);
    for (const regionMapSection of ['MAPSEC_KANTO_VICTORY_ROAD', 'MAPSEC_ROUTE_23', 'MAPSEC_INDIGO_PLATEAU']) {
      current = { ...VICTORY_ROAD, regionMapSection };
      expect(Overworld_MusicCanOverrideMapMusic(d('MUS_SURF'))).toBe(false);
      expect(Overworld_MusicCanOverrideMapMusic(d('MUS_CYCLING'))).toBe(false);
      expect(Overworld_MusicCanOverrideMapMusic(d('MUS_HEAL'))).toBe(true);
    }
    gPlayerAvatar.flags = PLAYER_AVATAR_FLAG.SURFING;
    Overworld_PlaySpecialMapMusic();
    expect(GetCurrentMapMusic()).toBe(d('MUS_VICTORY_ROAD'));
  });

  test('the same song is left playing; gDisableMapMusicChangeOnMapLoad KEEP leaves it, STOP stops it', () => {
    playMapMusic();
    expect(soundProbe().mapMusic.state).toBe(2);
    Overworld_PlaySpecialMapMusic(); // same song: no PlayNewMapMusic
    expect(soundProbe().mapMusic.state).toBe(2);

    current = ROUTE1;
    SetDisableMapMusicChangeOnMapLoad(MUSIC_DISABLE_KEEP);
    Overworld_PlaySpecialMapMusic();
    Overworld_TryMapConnectionMusicTransition(PALLET);
    expect(GetCurrentMapMusic()).toBe(d('MUS_PALLET'));
    expect(soundProbe().mapMusic.state).toBe(2);

    SetDisableMapMusicChangeOnMapLoad(MUSIC_DISABLE_STOP);
    Overworld_PlaySpecialMapMusic();
    expect(GetCurrentMapMusic()).toBe(0); // StopMapMusic: MUS_DUMMY at the frame's end
    expect(soundProbe().mapMusic.state).toBe(1);
    SetDisableMapMusicChangeOnMapLoad(MUSIC_DISABLE_OFF);
  });

  test('PlaySE is skipped while gDisableMapMusicChangeOnMapLoad is set; a soft reset clears it', () => {
    const events: SoundEvent[] = [];
    setSoundEventListener((e) => events.push(e));
    SetDisableMapMusicChangeOnMapLoad(MUSIC_DISABLE_KEEP);
    PlaySE(d('SE_EXIT'));
    expect(events).toEqual([]);
    AgbMainSoundInit(); // SoftReset clears EWRAM
    expect(soundProbe().disableMapMusicChangeOnMapLoad).toBe(MUSIC_DISABLE_OFF);
    PlaySE(d('SE_EXIT'));
    expect(events.map((e) => e.name)).toEqual(['SE_EXIT']);
  });

  test('TryFadeOutOldMapMusic: 32 frames into an indoor map, 64 outdoors, none for the same song', () => {
    // Pallet Town → the player's house: both MUS_PALLET, so no fade and BGMusicStopped at once
    playMapMusic();
    TryFadeOutOldMapMusic(PLAYERS_HOUSE);
    expect(BGMusicStopped()).toBe(true);
    expect(GetCurrentMapMusic()).toBe(d('MUS_PALLET'));

    // → Oak's lab (indoors, MUS_OAK_LAB): speed 2. BGMusicStopped turns TRUE in the frame after FadeOutBody stops
    // the player (sound.test.ts: 16 × speed + 1).
    TryFadeOutOldMapMusic(OAKS_LAB);
    expect(BGMusicStopped()).toBe(false);
    expect(framesUntil(BGMusicStopped)).toBe(16 * 2 + 1);
    expect(IsBGMStopped()).toBe(true);

    // Oak's lab → Route 1 (outdoors): speed 4
    current = OAKS_LAB;
    playMapMusic();
    TryFadeOutOldMapMusic(ROUTE1);
    expect(framesUntil(BGMusicStopped)).toBe(16 * 4 + 1);
  });

  test('FLAG_DONT_TRANSITION_MUSIC keeps the music through warps and connections', () => {
    playMapMusic();
    t.state.setFlag('FLAG_DONT_TRANSITION_MUSIC', true);
    TryFadeOutOldMapMusic(ROUTE1);
    expect(BGMusicStopped()).toBe(true);
    Overworld_TryMapConnectionMusicTransition(ROUTE1);
    expect(GetCurrentMapMusic()).toBe(d('MUS_PALLET'));
    expect(soundProbe().mapMusic.state).toBe(2);
  });

  test('a connection fades to the new song on foot (speed 8), crossfades on the bike, keeps MUS_SURF', () => {
    playMapMusic();
    Overworld_TryMapConnectionMusicTransition(ROUTE1);
    expect(soundProbe().mapMusic).toMatchObject({ state: 6, next: d('MUS_ROUTE1') }); // FadeOutAndPlayNewMapMusic
    expect(framesUntil(() => GetCurrentMapMusic() === d('MUS_ROUTE1'))).toBe(16 * 8 + 1);

    current = ROUTE1;
    gPlayerAvatar.flags = PLAYER_AVATAR_FLAG.MACH_BIKE;
    AgbMainFrameEnd();
    Overworld_TryMapConnectionMusicTransition(PALLET);
    expect(soundProbe().mapMusic).toMatchObject({ state: 7, next: d('MUS_PALLET'), fadeInSpeed: 4 }); // FadeOutAndFadeInNewMapMusic

    // Surfing: MUS_SURF plays on across the connection
    AgbMainSoundInit();
    gPlayerAvatar.flags = PLAYER_AVATAR_FLAG.SURFING;
    PlayNewMapMusic(d('MUS_SURF'));
    AgbMainFrameEnd();
    Overworld_TryMapConnectionMusicTransition(ROUTE1);
    expect(soundProbe().mapMusic.state).toBe(2);
    expect(GetCurrentMapMusic()).toBe(d('MUS_SURF'));
  });

  test("Overworld_ChangeMusicToDefault fades to the header's music, whatever savedMusic says", () => {
    Overworld_SetSavedMusic(d('MUS_CYCLING'));
    playMapMusic();
    expect(GetCurrentMapMusic()).toBe(d('MUS_CYCLING'));
    Overworld_ChangeMusicToDefault();
    expect(soundProbe().mapMusic).toMatchObject({ state: 6, next: d('MUS_PALLET') });
  });

  test("the Champion's room fades the victory music back in instead of the map's", () => {
    current = { id: 'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM', music: 'MUS_VICTORY_ROAD', mapType: 'MAP_TYPE_INDOOR', regionMapSection: 'MAPSEC_INDIGO_PLATEAU' };
    PlayBGM(d('MUS_VICTORY_GYM_LEADER'));
    AgbMainFrameEnd();
    const events: SoundEvent[] = [];
    setSoundEventListener((e) => events.push(e));
    local = { x: 6, y: 10 }; // y - 7 < 11 in map coordinates
    Overworld_PlaySpecialMapMusic();
    expect(events.map((e) => [e.type, e.name, e.fade, e.speed])).toEqual([['fade', 'MUS_VICTORY_GYM_LEADER', 'in', 4]]);
    expect(soundProbe().mapMusic.state).toBe(0);
    local = { x: 6, y: 11 };
    Overworld_PlaySpecialMapMusic();
    expect(GetCurrentMapMusic()).toBe(d('MUS_VICTORY_ROAD'));
  });
});
