// public/gen/audio/{voicegroups,samples,waves}.json + samples.bin (tools/extract_audio_voices.py): every reference
// resolves, every sample fits, and spot values from the decomp's sources (sound/voice_groups.inc, the WAVs as
// tools/wav2agb converts them, cry_tables.inc).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readGen } from './gameData';

interface Voice {
  type: number;
  key: number;
  length: number;
  panSweep: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  sample?: string;
  wave?: string;
  duty?: number;
  period?: number;
  subgroup?: string;
  keysplit?: string | null;
}
interface VoiceData {
  voicegroups: Record<string, (Voice | null)[]>;
  voicegroupSizes: Record<string, number>;
  keysplits: Record<string, (number | null)[]>;
  cries: Voice[];
  criesReverse: Voice[];
}
interface SampleInfo {
  freq: number;
  loop: boolean;
  loopStart: number;
  size: number;
  offset: number;
}

const data = readGen<VoiceData>('audio/voicegroups.json');
const samples = readGen<Record<string, SampleInfo>>('audio/samples.json');
const waves = readGen<Record<string, number[]>>('audio/waves.json');
const samplesBin = readFileSync(resolve(__dirname, '../../public/gen/audio/samples.bin'));
const defines = readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines;

const allVoices = (): Voice[] => [
  ...Object.values(data.voicegroups).flatMap((g) => g.filter((v): v is Voice => v !== null)),
  ...data.cries,
  ...data.criesReverse,
];

describe('voicegroups', () => {
  test('77 voicegroups, 128 voices each (256 for keysplit subgroups)', () => {
    expect(Object.keys(data.voicegroups)).toHaveLength(77);
    const subgroups = new Set(allVoices().filter((v) => v.type === 0x40).map((v) => v.subgroup));
    for (const [name, group] of Object.entries(data.voicegroups)) {
      expect(group, name).toHaveLength(subgroups.has(name) ? 256 : 128);
    }
  });

  test('every sample, wave, subgroup and keysplit table a voice names exists', () => {
    for (const v of allVoices()) {
      if (v.sample !== undefined) expect(samples, v.sample).toHaveProperty([v.sample]);
      if (v.wave !== undefined) expect(waves, v.wave).toHaveProperty([v.wave]);
      if (v.subgroup !== undefined) expect(data.voicegroups, v.subgroup).toHaveProperty([v.subgroup]);
      if (v.keysplit) expect(data.keysplits, v.keysplit).toHaveProperty([v.keysplit]);
      const cgb = v.type & 7; // TONEDATA_TYPE_CGB: 0 = DirectSound, 1-2 squares, 3 wave, 4 noise
      if (v.type === 0x40) expect(v.keysplit).toBeTruthy();
      else if (v.type === 0x80) expect(v.keysplit).toBeNull();
      else if (cgb === 0) expect(v.sample).toBeDefined();
      else if (cgb === 3) expect(v.wave).toBeDefined();
      else if (cgb === 4) expect(v.period).toBeDefined();
      else expect(v.duty).toBeDefined();
    }
  });

  test('a keysplit table resolves every key in its range to a voice of its subgroup', () => {
    for (const v of allVoices().filter((x) => x.type === 0x40)) {
      const table = data.keysplits[v.keysplit!];
      const group = data.voicegroups[v.subgroup!];
      // keysplit_tables.inc: every table maps keys 36-107 (KeySplitTable4 from 24).
      for (let key = 36; key <= 107; key++) {
        const i = table[key];
        expect(i, `${v.keysplit}[${key}]`).not.toBeNull();
        expect(group[i!], `${v.subgroup}[${i}]`).not.toBeNull();
      }
    }
  });

  test('voicegroups run on into the next one, as ply_note indexes them in the ROM', () => {
    // voice_groups.inc: voicegroup001 (a rhythm set) defines 29 voices; key 29 reads voicegroup002's first.
    expect(data.voicegroupSizes.voicegroup001).toBe(29);
    expect(data.voicegroups.voicegroup001[29]).toEqual(data.voicegroups.voicegroup002[0]);
    // voicegroup190 is the last (88 voices): past it lie the keysplit tables, which aren't voices.
    expect(data.voicegroups.voicegroup190[87]).not.toBeNull();
    expect(data.voicegroups.voicegroup190[88]).toBeNull();
  });

  test('spot values from voice_groups.inc and keysplit_tables.inc', () => {
    const vg0 = data.voicegroups.voicegroup000;
    // voice_keysplit_all voicegroup001 / voice_keysplit voicegroup003, KeySplitTable1
    expect(vg0[0]).toMatchObject({ type: 0x80, subgroup: 'voicegroup001', keysplit: null });
    expect(vg0[1]).toMatchObject({ type: 0x40, subgroup: 'voicegroup003', keysplit: 'KeySplitTable1' });
    // voice_square_2 60, 0, 2, 0, 0, 9, 2
    expect(vg0[6]).toEqual({
      type: 2, key: 60, length: 0, panSweep: 0, duty: 2, attack: 0, decay: 0, sustain: 9, release: 2,
    });
    // voice_directsound 60, 0, DirectSoundWaveData_sc88pro_glockenspiel, 255, 165, 51, 235
    expect(vg0[9]).toEqual({
      type: 0, key: 60, length: 0, panSweep: 0, sample: 'DirectSoundWaveData_sc88pro_glockenspiel',
      attack: 255, decay: 165, sustain: 51, release: 235,
    });
    // voice_directsound_no_resample 64, 104, DirectSoundWaveData_ethnic_flavours_atarigane, 255, 0, 255, 0
    // (voicegroup190's 87th voice): type 0x08, pan_sweep = 0x80 | 104
    expect(data.voicegroups.voicegroup190[86]).toMatchObject({
      type: 0x08, key: 64, panSweep: 0x80 | 104, sample: 'DirectSoundWaveData_ethnic_flavours_atarigane',
    });
    // KeySplitTable1 = . - 36: keys 36-54 are 0, 55 is 1.
    expect(data.keysplits.KeySplitTable1[36]).toBe(0);
    expect(data.keysplits.KeySplitTable1[54]).toBe(0);
    expect(data.keysplits.KeySplitTable1[55]).toBe(1);
  });
});

describe('samples', () => {
  test('477 samples (89 instruments + 388 cries), each inside samples.bin', () => {
    expect(Object.keys(samples)).toHaveLength(477);
    for (const [name, s] of Object.entries(samples)) {
      // wav2agb writes size + 1 samples (agbl = the smpl loop end - 1), and the mixer may read that last one.
      expect(s.offset + s.size + 1, name).toBeLessThanOrEqual(samplesBin.length);
      expect(s.offset % 4, name).toBe(0);
      if (s.loop) expect(s.loopStart, name).toBeLessThan(s.size);
    }
  });

  test('spot values (as tools/wav2agb -b writes the WaveData header)', () => {
    expect(samples.DirectSoundWaveData_classical_choir_voice_ahhs).toMatchObject({
      freq: 13379 * 1024, loop: true, loopStart: 4001, size: 5788,
    });
    expect(samples.Cry_Bulbasaur).toMatchObject({ freq: 10512 * 1024, loop: false, loopStart: 0 });
  });

  test('programmable waves: 11 of 16 bytes', () => {
    expect(Object.keys(waves)).toHaveLength(11);
    for (const w of Object.values(waves)) expect(w).toHaveLength(16);
    // sound/programmable_wave_samples/01.pcm
    expect(waves.ProgrammableWaveData_1.slice(0, 8)).toEqual([0x01, 0x25, 0x8a, 0xde, 0xfe, 0xc9, 0x63, 0x10]);
  });
});

describe('cries', () => {
  test('one cry per cry id (SpeciesToCryId: CRY_CHIMECHO is the last)', () => {
    const count = defines.CRY_CHIMECHO + 1;
    expect(data.cries).toHaveLength(count);
    expect(data.criesReverse).toHaveLength(count);
    // cry / cry_reverse = voice_directsound_compressed[_reverse] 60, 0, sample, 255, 0, 255, 0
    data.cries.forEach((v, i) => {
      expect(v).toMatchObject({ type: 0x20, key: 60, panSweep: 0, attack: 255, decay: 0, sustain: 255, release: 0 });
      expect(data.criesReverse[i]).toEqual({ ...v, type: 0x30 });
    });
    expect(data.cries[0].sample).toBe('Cry_Bulbasaur');
    expect(data.cries[defines.CRY_CHIMECHO].sample).toBe('Cry_Chimecho');
  });
});

// songs.json is W-audiodata 1's (tools/extract_audio.py); this runs once both units are on master.
const songsPath = resolve(__dirname, '../../public/gen/audio/songs.json');
describe.skipIf(!existsSync(songsPath))('songs', () => {
  test("every song's voicegroup resolves", () => {
    const raw = JSON.parse(readFileSync(songsPath, 'utf8')) as unknown;
    const found: unknown[] = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') {
        if ('voicegroup' in x) found.push((x as { voicegroup: unknown }).voicegroup);
        else Object.values(x).forEach(walk);
      }
    };
    walk(raw);
    expect(found.length).toBeGreaterThan(300);
    for (const vg of found) {
      // mid2agb writes `.equ <song>_grp, voicegroup%03u` (agb.cpp): a name, or the -G number.
      const name = typeof vg === 'number' ? `voicegroup${String(vg).padStart(3, '0')}` : String(vg);
      expect(data.voicegroups, name).toHaveProperty([name]);
    }
  });
});
