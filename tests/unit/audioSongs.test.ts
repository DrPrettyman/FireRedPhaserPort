// public/gen/audio/songs.json (tools/extract_audio.py): the decomp's mid2agb output, assembled, joined with
// sound/song_table.inc (gSongTable) and sound/music_player_table.inc (gMPlayTable).

import { describe, expect, test } from 'vitest';
import { readGen } from './gameData';

interface SongsJson {
  players: { name: string; tracks: number }[];
  songs: {
    id: number;
    name: string;
    ms: number;
    me: number;
    priority: number;
    reverb: number;
    blockCount: number;
    voicegroup: string | null;
    tracks: number[];
    data: string;
  }[];
}

const FINE = 0xb1;
const GOTO = 0xb2;
const REVERB_SET = 0x80; // MPlayDef.s reverb_set: mid2agb writes reverb_set+<-R>

const json = readGen<SongsJson>('audio/songs.json');
const defines = readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines;
const songs = json.songs.map((s) => ({ ...s, bytes: Buffer.from(s.data, 'base64') }));
const byName = new Map(songs.map((s) => [s.name, s]));

function song(name: string) {
  const s = byName.get(name);
  if (!s) throw new Error(`no song ${name}`);
  return s;
}

describe('songs.json', () => {
  test('gMPlayTable: the four music players and their track counts', () => {
    expect(json.players).toEqual([
      { name: 'gMPlayInfo_BGM', tracks: 10 },
      { name: 'gMPlayInfo_SE1', tracks: 3 },
      { name: 'gMPlayInfo_SE2', tracks: 9 },
      { name: 'gMPlayInfo_SE3', tracks: 1 },
    ]);
  });

  test('gSongTable: 347 songs (none on dummy_song_header), indexed by id', () => {
    expect(songs).toHaveLength(347);
    songs.forEach((s, i) => expect(s.id).toBe(i));
    expect(songs.filter((s) => s.name === 'dummy_song_header')).toHaveLength(0);
    expect(songs[0].name).toBe('mus_dummy');
  });

  test('song ids match the SE_* / MUS_* constants (include/constants/songs.h)', () => {
    const constants = Object.entries(defines).filter(
      ([k]) => (k.startsWith('SE_') || k.startsWith('MUS_')) && k !== 'MUS_NONE',
    );
    expect(constants).toHaveLength(songs.length);
    for (const [name, id] of constants) expect(songs[id]?.name.toUpperCase(), name).toBe(name);
  });

  test('players and priorities of known songs (midi.cfg -P, song_table.inc players)', () => {
    const cases: [string, number, number][] = [
      // name, music player (ms = me), priority
      ['mus_pallet', 0, 0],
      ['mus_route1', 0, 0],
      ['mus_evolution', 0, 1],
      ['mus_level_up', 2, 5],
      ['mus_obtain_item', 2, 5],
      ['mus_obtain_badge', 2, 5],
      ['se_select', 2, 5],
      ['se_door', 1, 5],
      ['se_ledge', 1, 4],
    ];
    for (const [name, player, priority] of cases) {
      const s = song(name);
      expect([s.ms, s.me, s.priority], name).toEqual([player, player, priority]);
    }
    // Every song is on a real player; SEs on 1-3, at priority 2-5; every BGM-player song is MUS_*.
    for (const s of songs) {
      expect(s.ms).toBeLessThan(json.players.length);
      if (s.name.startsWith('se_')) {
        expect(s.ms, s.name).toBeGreaterThanOrEqual(1);
        expect(s.priority, s.name).toBeGreaterThanOrEqual(2);
      }
      if (s.ms === 0) expect(s.name, s.name).toMatch(/^mus_/);
    }
    // Fanfares (sFanfares, sound.c) play on player 2 at priority 5.
    for (const name of ['mus_level_up', 'mus_obtain_item', 'mus_evolved', 'mus_obtain_tmhm', 'mus_heal'])
      expect([song(name).ms, song(name).priority], name).toEqual([2, 5]);
  });

  test('header bytes: reverb, voicegroup, track counts', () => {
    expect(song('se_select').reverb).toBe(REVERB_SET + 50);
    expect(song('mus_dummy').reverb).toBe(REVERB_SET + 40);
    expect(song('mus_dummy').tracks).toEqual([]);
    expect(song('se_select').voicegroup).toBe('voicegroup127');
    expect(song('mus_pallet').voicegroup).toBe('voicegroup159');
    expect(song('mus_pallet').tracks).toHaveLength(6);
    for (const s of songs) {
      expect(s.voicegroup, s.name).toMatch(/^voicegroup\d{3}$/);
      expect(s.blockCount).toBe(0);
      // A song needs no more tracks than its player has (MPlayStart only runs that many).
      expect(s.tracks.length, s.name).toBeLessThanOrEqual(json.players[s.ms].tracks);
    }
  });

  // KEYSH 0, TEMPO 300/2, VOICE 87, VOL 127*80/127, BEND c_v+13, N03 As5 v068, W03 (MPlayDef.s values)
  test('se_select: the bytes mid2agb writes', () => {
    expect([...song('se_select').bytes.subarray(0, 14)]).toEqual([
      0xbc, 0, 0xbb, 150, 0xbd, 87, 0xbe, 80, 0xc0, 0x40 + 13, 0xd2, 94, 68, 0x83,
    ]);
  });

  // mid2agb ends every track with FINE; a looping one has `GOTO <loop label>` before it (at the `]` marker).
  test('every track is inside its data, its commands walk to a FINE at its end, its pointers stay inside', () => {
    const looping = new Set<string>();
    let pointers = 0;
    for (const s of songs) {
      for (const start of s.tracks) {
        expect(start, s.name).toBeGreaterThanOrEqual(0);
        expect(start, s.name).toBeLessThan(s.bytes.length);
        const walk = walkTrack(s.bytes, start);
        expect(walk.fine + 1, `${s.name} track at ${start}`).toBe(trackEnd(s, start));
        for (const [cmd, target] of walk.pointers) {
          expect(target, `${s.name} ${cmd.toString(16)}`).toBeLessThan(s.bytes.length);
          if (cmd === GOTO) {
            expect(target, `${s.name} GOTO`).toBeGreaterThanOrEqual(start); // a loop stays in its track
            looping.add(s.name);
          }
        }
        pointers += walk.pointers.length;
      }
    }
    expect(looping.size).toBe(77); // AUDIO_PLAN.md spike 2: 77 songs loop, 270 end
    expect(pointers).toBe(3088); // the `.word`s in mid2agb's output: 2530 PATT + 558 GOTO
  });
});

/** Where the track at `start` ends: the next track, or for the last one the data's end before its `.align 2` pad. */
function trackEnd(s: { bytes: Buffer; tracks: number[] }, start: number): number {
  const next = s.tracks.filter((t) => t > start).sort((a, b) => a - b)[0];
  if (next !== undefined) return next;
  let end = s.bytes.length;
  while (s.bytes.length - end < 3 && s.bytes[end - 1] === 0) end--;
  return end;
}

/**
 * Walks a track's commands in order (not following jumps) to its FINE, with MPlayMain's lengths (m4a_1.s): waits
 * 0x80-0xB0, GOTO / PATT + u32, PEND, REPT + count + u32, MEMACC + 3, PRIO..TUNE + 1, XCMD + 2, EOT [+ key],
 * notes [+ key [+ velocity [+ gate]]]; a byte < 0x80 repeats the last command >= VOICE (running status).
 */
function walkTrack(bytes: Buffer, start: number): { fine: number; pointers: [number, number][] } {
  const pointers: [number, number][] = [];
  let pc = start;
  let running = 0;
  const args = (cmd: number) => {
    if (cmd >= 0xce) {
      // EOT takes one optional key; notes take up to three bytes < 0x80
      for (let n = cmd === 0xce ? 1 : 3; n > 0 && bytes[pc] < 0x80; n--) pc++;
    } else if (cmd === 0xcd) pc += 2;
    else pc += 1;
  };
  while (pc < bytes.length) {
    const b = bytes[pc];
    if (b < 0x80) {
      if (running < 0xbd) throw new Error(`data byte at ${pc} with no running command`);
      args(running);
      continue;
    }
    pc++;
    if (b <= 0xb0) continue;
    if (b === FINE) return { fine: pc - 1, pointers };
    if (b === GOTO || b === 0xb3) {
      pointers.push([b, bytes.readUInt32LE(pc)]);
      pc += 4;
    } else if (b === 0xb4) continue;
    else if (b === 0xb5) {
      pointers.push([b, bytes.readUInt32LE(pc + 1)]);
      pc += 5;
    } else if (b === 0xb9) pc += 3;
    else if ((b >= 0xba && b <= 0xc5) || b === 0xc8) {
      if (b >= 0xbd) running = b;
      pc++;
    } else if (b >= 0xcd) {
      running = b;
      args(b);
    } else throw new Error(`unknown command ${b.toString(16)} at ${pc - 1}`);
  }
  throw new Error(`no FINE after ${start}`);
}
