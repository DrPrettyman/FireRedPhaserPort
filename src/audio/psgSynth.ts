// The GBA's PSG (the Game Boy's four sound channels inside the GBA, GBATEK "Sound Channel 1-4", Pan Docs "Audio
// Details"): squares 1 and 2 (duty, square 1's sweep), the wave channel (32 4-bit samples in two banks), noise
// (the LFSR), each with its length counter and (squares, noise) the hardware envelope, the frame sequencer that
// clocks them (512 Hz), and NR50 / NR51 / SOUNDCNT_H's mixing into the 10-bit sum the DAC adds to the FIFOs.
// Driven by the m4a engine's register writes (PsgFrame in soundRegs.ts: CgbSound, CgbOscOff, MPlayExtender,
// SoundInit), replayed as the hardware takes them. Pure: no DOM, no Web Audio (the worklet and the headless
// renderers use it through outputCore.ts's SoundCircuit).
//
// Where the documents leave the GBA's behaviour open, this follows mGBA's GB_AUDIO_GBA style (src/gb/audio.c),
// which is what W-ref 2 compares with: the PSG adds unsigned levels (no DC offset), a square's duty position and
// the wave channel's position survive a restart, the wave RAM rotates as it plays, noise starts its LFSR at 0
// with XNOR feedback. Times are in GBA cycles (2^24 Hz); a GBA frame is 280,896 of them.

import {
  PSG_NR10,
  PSG_NR11,
  PSG_NR12,
  PSG_NR13,
  PSG_NR14,
  PSG_NR21,
  PSG_NR22,
  PSG_NR23,
  PSG_NR24,
  PSG_NR30,
  PSG_NR31,
  PSG_NR32,
  PSG_NR33,
  PSG_NR34,
  PSG_NR41,
  PSG_NR42,
  PSG_NR43,
  PSG_NR44,
  PSG_NR50,
  PSG_NR51,
  PSG_NR52,
  PSG_SOUNDBIAS_H,
  PSG_SOUNDBIAS_L,
  PSG_SOUNDCNT_H_H,
  PSG_SOUNDCNT_H_L,
  PSG_STATE_BANK0,
  PSG_STATE_BANK1,
  PSG_STATE_SIZE,
  PSG_WAVE_RAM,
  PSG_WAVE_RAM_END,
} from './soundRegs';

/** The CPU clock: 16,777,216 Hz. */
export const GBA_CPU_HZ = 1 << 24;
/** One GBA frame: 228 lines of 1,232 cycles (59.7275 Hz). */
export const GBA_CYCLES_PER_FRAME = 280896;
/** The frame sequencer's period (512 Hz): length at steps 0, 2, 4, 6 (256 Hz), sweep at 2 and 6 (128 Hz), the
 *  envelopes at 7 (64 Hz). */
export const FRAME_SEQUENCER_CYCLES = 32768;

/** The duty patterns (NRx1 bits 6-7: 12.5%, 25%, 50%, 75%), one bit per step of the square's 8. */
export const SQUARE_DUTY: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
];

/** The hardware envelope (NRx2): the volume the channel plays at, stepped at 64 Hz. */
export interface Envelope {
  /** NRx2 bits 4-7: the volume a restart loads. */
  initial: number;
  /** NRx2 bit 3: 1 up, 0 down. */
  up: boolean;
  /** NRx2 bits 0-2: 64 Hz clocks per step (0: no steps). */
  stepTime: number;
  /** The current volume, 0-15. */
  volume: number;
  /** Clocks to the next step. */
  nextStep: number;
  /** 1: stopped at 15 (or no steps), 2: stopped at 0. */
  dead: number;
}

const newEnvelope = (): Envelope => ({ initial: 0, up: false, stepTime: 0, volume: 0, nextStep: 0, dead: 2 });

/** NRx2 written (mGBA _writeEnvelope, GBA style: no "zombie" volume change). Returns whether the DAC is on (any of
 *  bits 3-7 set); a DAC turned off silences the channel. */
function writeEnvelope(env: Envelope, value: number): boolean {
  env.stepTime = value & 7;
  env.up = (value & 8) !== 0;
  env.initial = value >> 4;
  updateEnvelopeDead(env);
  return env.initial !== 0 || env.up;
}

/** A restart (NRx4 bit 7): the volume from NRx2, the step counter reloaded (mGBA _resetEnvelope). */
function resetEnvelope(env: Envelope): boolean {
  env.volume = env.initial;
  env.nextStep = env.stepTime;
  updateEnvelopeDead(env);
  return env.initial !== 0 || env.up;
}

function updateEnvelopeDead(env: Envelope): void {
  if (!env.stepTime) env.dead = env.volume ? 1 : 2;
  else if (!env.up && !env.volume) env.dead = 2;
  else if (env.up && env.volume === 15) env.dead = 1;
  else if (env.dead) {
    env.nextStep = env.stepTime;
    env.dead = 0;
  }
}

/** One 64 Hz envelope clock. */
function clockEnvelope(env: Envelope): void {
  if (env.dead || --env.nextStep !== 0) return;
  env.volume += env.up ? 1 : -1;
  if (env.volume >= 15) {
    env.volume = 15;
    env.dead = 1;
  } else if (env.volume <= 0) {
    env.volume = 0;
    env.dead = 2;
  } else env.nextStep = env.stepTime;
}

/** A square channel (1 or 2). */
export interface Square {
  on: boolean;
  /** NRx3 / NRx4 bits 0-2: 11 bits; a step lasts 16 × (2048 − freq) cycles (131,072 / (2048 − freq) Hz). */
  freq: number;
  duty: number;
  /** The step in the duty pattern (0-7): free-running, a restart doesn't move it. */
  index: number;
  /** Cycles to the next step. */
  timer: number;
  /** The length counter (64 − NRx1 bits 0-5) and NRx4 bit 6. */
  length: number;
  lengthEnable: boolean;
  env: Envelope;
}

/** Square 1's sweep unit (NR10). */
export interface Sweep {
  /** Bits 4-6, 0 read as 8 (no sweep steps). */
  time: number;
  /** Bit 3: 1 down. */
  down: boolean;
  shift: number;
  step: number;
  enable: boolean;
  /** A calculation in the down direction happened since the restart (a switch to up then turns the channel off). */
  occurred: boolean;
  /** The shadow frequency the sweep calculates from (loaded at a restart). */
  shadow: number;
}

/** The wave channel (3). */
export interface Wave {
  on: boolean;
  /** NR30 bit 7: the DAC. */
  dac: boolean;
  /** NR30 bit 5: both banks as one 64-sample wave. */
  dimension: boolean;
  /** NR30 bit 6: the bank played (the CPU reaches the other). */
  bank: number;
  /** NR33 / NR34 bits 0-2: a sample lasts 8 × (2048 − freq) cycles. */
  freq: number;
  timer: number;
  length: number;
  lengthEnable: boolean;
  /** NR32: bits 5-6 the volume (0 mute, 1 100%, 2 50%, 3 25%), bit 7 75% whatever they say. */
  volume: number;
  /** The 64 samples: bank 0 (0-31), then bank 1, each in memory order (a byte's high nibble first). */
  ram: Uint8Array;
  /** How far the playing region has rotated since it was last written back (lazy: see normalizeWave). */
  rot: number;
  /** The sample playing: the last one rotated out. Kept across restarts and while off. */
  sample: number;
}

/** The noise channel (4). */
export interface Noise {
  on: boolean;
  /** NR43 bits 0-2 (the divisor: 0 counts as 0.5), bit 3 (the 7-bit LFSR), bits 4-7 (the clock shift). */
  ratio: number;
  width7: boolean;
  shift: number;
  lfsr: number;
  /** The LFSR's last feedback bit: 1 plays the envelope's volume. */
  out: number;
  timer: number;
  length: number;
  lengthEnable: boolean;
  env: Envelope;
}

const newSquare = (): Square => ({
  on: false,
  freq: 0,
  duty: 0,
  index: 0,
  timer: 16 * 2048,
  length: 0,
  lengthEnable: false,
  env: newEnvelope(),
});

/** Cycles per LFSR clock: 524,288 Hz / r / 2^(s + 1), r = 0 as 0.5 (GBATEK); shifts 14 and 15 get no clocks. */
export function noisePeriod(n: Noise): number {
  if (n.shift >= 14) return Infinity;
  return (n.ratio ? 64 * n.ratio : 32) * 2 ** n.shift;
}

/** One LFSR clock (Pan Docs, mGBA): the XNOR of bits 0 and 1 goes into bit 14 (and bit 6 in 7-bit mode) as the
 *  register shifts right; it is also the channel's output bit. */
export function clockLfsr(n: Noise): void {
  const bit = 1 ^ ((n.lfsr ^ (n.lfsr >> 1)) & 1);
  n.lfsr = (n.lfsr >> 1) | (bit << 14);
  if (n.width7) n.lfsr = (n.lfsr & ~0x40) | (bit << 6);
  n.out = bit;
}

/** The wave channel's output for a sample: NR32's volume (bit 7: ×3/4). */
export function waveLevel(sample: number, volume: number): number {
  if (volume & 0x80) return (sample * 3) >> 2;
  switch ((volume >> 5) & 3) {
    case 1:
      return sample;
    case 2:
      return sample >> 1;
    case 3:
      return sample >> 2;
    default:
      return 0;
  }
}

/**
 * The PSG. `write` takes the engine's register writes in order; `render` plays it forward, filling per-sample PSG
 * levels in the DAC's 10-bit units (what the GBA adds to the FIFOs' ×4 / ×2): with `dacInterval` (SoundCircuit) as
 * the GBA's 8-bit PWM takes it, point samples at 65,536 Hz held and averaged to the output's samples; without, each
 * the channels' average over the sample's cycles (a box filter).
 *
 * `regs` mirrors the engine's register file (soundRegs.ts: latched values, wave RAM writes in the bank the CPU
 * reaches) so the output can tell whether it missed writes (`matchesState`) and pick up from a frame's `state`.
 */
export class PsgSynth {
  /** soundRegs.ts's register file, as the writes left it (PsgFrame.state's layout). */
  readonly regs = new Uint8Array(PSG_STATE_SIZE);
  /** NR52 bit 7. */
  master = false;
  readonly sq1 = newSquare();
  readonly sq2 = newSquare();
  readonly sweep: Sweep = { time: 8, down: false, shift: 0, step: 8, enable: false, occurred: false, shadow: 0 };
  readonly wave: Wave = {
    on: false,
    dac: false,
    dimension: false,
    bank: 0,
    freq: 0,
    timer: 8 * 2048,
    length: 0,
    lengthEnable: false,
    volume: 0,
    ram: new Uint8Array(64),
    rot: 0,
    sample: 0,
  };
  readonly noise: Noise = {
    on: false,
    ratio: 0,
    width7: false,
    shift: 0,
    lfsr: 0,
    out: 0,
    timer: 32,
    length: 0,
    lengthEnable: false,
    env: newEnvelope(),
  };
  /** NR50: the PSG's master volume per side (0-7: ×1-8). */
  volRight = 0;
  volLeft = 0;
  /** NR51: bits 0-3 channels 1-4 right, 4-7 left. */
  nr51 = 0;
  /** REG_SOUNDCNT_H (bits 0-1: the PSG's share; the FIFOs' routing). */
  soundcntH = 0;
  /** REG_SOUNDBIAS (bits 1-9 the bias, 14-15 the resolution). */
  soundbias = 0x200;
  /** The frame sequencer's last step (0-7) and the cycles to its next. */
  seqStep = 7;
  seqCountdown = FRAME_SEQUENCER_CYCLES;
  /** How `render` turns the channels into samples. 0: each sample is the channels' average over its cycles (a box
   *  filter: the channels' levels as such, which the hand-worked tests read). Otherwise the GBA's way, which
   *  SoundCircuit sets: the DAC point-samples the PSG every `dacInterval` cycles (0x200 >> SOUNDBIAS's resolution:
   *  256, 65,536 Hz, for FRLG) and holds it, and each output sample is that held signal's average over its cycles. */
  dacInterval = 0;
  /** Cycles to the DAC's next point sample, and the levels it took at the last (per side, 10-bit units). */
  dacCountdown = 0;
  /** Cycles the channels haven't been moved on by yet (DAC mode moves them only at its ticks). */
  private pending = 0;
  heldL = 0;
  heldR = 0;

  constructor() {
    this.reset();
  }

  /** The power-on state (as soundRegs.ts's resetSoundRegs: everything 0, SOUNDBIAS 0x200). */
  reset(): void {
    this.regs.fill(0);
    this.regs[PSG_SOUNDBIAS_H] = 0x02;
    this.master = false;
    Object.assign(this.sq1, newSquare());
    Object.assign(this.sq2, newSquare());
    Object.assign(this.sweep, { time: 8, down: false, shift: 0, step: 8, enable: false, occurred: false, shadow: 0 });
    const w = this.wave;
    Object.assign(w, { on: false, dac: false, dimension: false, bank: 0, freq: 0, timer: 8 * 2048, length: 0 });
    Object.assign(w, { lengthEnable: false, volume: 0, rot: 0, sample: 0 });
    w.ram.fill(0);
    Object.assign(this.noise, { on: false, ratio: 0, width7: false, shift: 0, lfsr: 0, out: 0, timer: 32, length: 0 });
    this.noise.lengthEnable = false;
    this.noise.env = newEnvelope();
    this.volRight = this.volLeft = this.nr51 = this.soundcntH = 0;
    this.soundbias = 0x200;
    this.seqStep = 7;
    this.seqCountdown = FRAME_SEQUENCER_CYCLES;
    this.dacCountdown = 0;
    this.pending = 0;
    this.heldL = this.heldR = 0;
  }

  /**
   * Pick up from a frame's `state` (PsgFrame.state): the registers as latched, no events, so every channel is off
   * until its next restart (the output starting mid-song, or after it missed frames).
   */
  loadState(state: Uint8Array): void {
    this.reset();
    this.write(PSG_NR52, state[PSG_NR52]);
    // The latches, without NRx4's restart bit.
    for (const off of [PSG_NR10, PSG_NR11, PSG_NR12, PSG_NR13, PSG_NR21, PSG_NR22, PSG_NR23, PSG_NR30, PSG_NR31]) {
      this.write(off, state[off]);
    }
    for (const off of [PSG_NR32, PSG_NR33, PSG_NR41, PSG_NR42, PSG_NR43, PSG_NR50, PSG_NR51]) this.write(off, state[off]);
    for (const off of [PSG_NR14, PSG_NR24, PSG_NR34, PSG_NR44]) this.write(off, state[off] & 0x7f);
    for (const off of [PSG_SOUNDCNT_H_L, PSG_SOUNDCNT_H_H, PSG_SOUNDBIAS_L, PSG_SOUNDBIAS_H]) this.write(off, state[off]);
    // Wave RAM: both banks as written (nothing has rotated them yet).
    for (let i = 0; i < 16; i++) {
      this.wave.ram[2 * i] = state[PSG_STATE_BANK0 + i] >> 4;
      this.wave.ram[2 * i + 1] = state[PSG_STATE_BANK0 + i] & 15;
      this.wave.ram[32 + 2 * i] = state[PSG_STATE_BANK1 + i] >> 4;
      this.wave.ram[32 + 2 * i + 1] = state[PSG_STATE_BANK1 + i] & 15;
    }
    this.regs.set(state);
    this.sq1.on = this.sq2.on = this.wave.on = this.noise.on = false;
  }

  /** Whether the writes so far leave the registers as `state` says (else frames were missed: loadState). */
  matchesState(state: Uint8Array): boolean {
    const regs = this.regs;
    for (let i = 0; i < PSG_STATE_SIZE; i++) if (regs[i] !== state[i]) return false;
    return true;
  }

  /** A byte write to REG_SOUND1CNT_L + offset, as the hardware takes it. */
  write(offset: number, value: number): void {
    offset &= 0xff;
    value &= 0xff;
    if (offset >= PSG_WAVE_RAM_END) return;
    // The mirror of soundRegs.ts's register file.
    if (offset >= PSG_WAVE_RAM) {
      const bank = this.regs[PSG_NR30] & 0x40 ? PSG_STATE_BANK0 : PSG_STATE_BANK1;
      this.regs[bank + offset - PSG_WAVE_RAM] = value;
      this.writeWaveRam(offset - PSG_WAVE_RAM, value);
      return;
    }
    this.regs[offset] = value;
    // NR10-NR51 are reset and ignore writes while NR52 bit 7 is off (GBATEK "SOUNDCNT_X").
    if (offset < PSG_SOUNDCNT_H_L && !this.master) return;
    const seqEven = !(this.seqStep & 1);
    switch (offset) {
      case PSG_NR10: {
        const s = this.sweep;
        const wasDown = s.down;
        s.shift = value & 7;
        s.down = (value & 8) !== 0;
        if (s.occurred && wasDown && !s.down) this.sq1.on = false;
        s.occurred = false;
        s.time = (value >> 4) & 7 || 8;
        break;
      }
      case PSG_NR11:
      case PSG_NR21: {
        const sq = offset === PSG_NR11 ? this.sq1 : this.sq2;
        sq.duty = value >> 6;
        sq.length = 64 - (value & 63);
        break;
      }
      case PSG_NR12:
      case PSG_NR22: {
        const sq = offset === PSG_NR12 ? this.sq1 : this.sq2;
        if (!writeEnvelope(sq.env, value)) sq.on = false;
        break;
      }
      case PSG_NR13:
      case PSG_NR23: {
        const sq = offset === PSG_NR13 ? this.sq1 : this.sq2;
        sq.freq = (sq.freq & 0x700) | value;
        break;
      }
      case PSG_NR14:
      case PSG_NR24: {
        const sq = offset === PSG_NR14 ? this.sq1 : this.sq2;
        sq.freq = (sq.freq & 0xff) | ((value & 7) << 8);
        this.writeLengthEnable(sq, (value & 0x40) !== 0, seqEven);
        if (value & 0x80) {
          sq.on = resetEnvelope(sq.env);
          if (sq === this.sq1) {
            const s = this.sweep;
            s.shadow = sq.freq;
            s.step = s.time;
            s.enable = s.step !== 8 || s.shift !== 0;
            s.occurred = false;
            if (sq.on && s.shift) sq.on = this.updateSweep(true);
          }
          this.reloadLength(sq, 64, seqEven);
        }
        break;
      }
      case PSG_NR30: {
        const w = this.wave;
        const dimension = (value & 0x20) !== 0;
        const bank = (value >> 6) & 1;
        if (dimension !== w.dimension || bank !== w.bank) {
          this.normalizeWave();
          w.dimension = dimension;
          w.bank = bank;
        }
        w.dac = (value & 0x80) !== 0;
        if (!w.dac) w.on = false;
        break;
      }
      case PSG_NR31:
        this.wave.length = 256 - value;
        break;
      case PSG_NR32:
        this.wave.volume = value & 0xe0;
        break;
      case PSG_NR33:
        this.wave.freq = (this.wave.freq & 0x700) | value;
        break;
      case PSG_NR34: {
        const w = this.wave;
        w.freq = (w.freq & 0xff) | ((value & 7) << 8);
        this.writeLengthEnable(w, (value & 0x40) !== 0, seqEven);
        if (value & 0x80) {
          w.on = w.dac;
          this.reloadLength(w, 256, seqEven);
          // The position isn't reset on the GBA (its wave RAM rotates); the sample timer starts over.
          w.timer = 8 * (2048 - w.freq);
        }
        break;
      }
      case PSG_NR41:
        this.noise.length = 64 - (value & 63);
        break;
      case PSG_NR42:
        if (!writeEnvelope(this.noise.env, value)) this.noise.on = false;
        break;
      case PSG_NR43:
        this.noise.ratio = value & 7;
        this.noise.width7 = (value & 8) !== 0;
        this.noise.shift = value >> 4;
        break;
      case PSG_NR44: {
        const n = this.noise;
        this.writeLengthEnable(n, (value & 0x40) !== 0, seqEven);
        if (value & 0x80) {
          n.on = resetEnvelope(n.env);
          n.lfsr = 0;
          n.timer = noisePeriod(n);
          this.reloadLength(n, 64, seqEven);
        }
        break;
      }
      case PSG_NR50:
        this.volRight = value & 7;
        this.volLeft = (value >> 4) & 7;
        break;
      case PSG_NR51:
        this.nr51 = value;
        break;
      case PSG_SOUNDCNT_H_L:
        this.soundcntH = (this.soundcntH & 0xff00) | value;
        break;
      case PSG_SOUNDCNT_H_H:
        this.soundcntH = (this.soundcntH & 0xff) | (value << 8);
        break;
      case PSG_NR52: {
        const on = (value & 0x80) !== 0;
        if (!on && this.master) {
          // Off: every channel stops and NR10-NR51 are cleared (in the hardware; the mirror keeps what the engine
          // wrote, as soundRegs.ts does).
          const mirror = this.regs.slice();
          for (const off of [PSG_NR10, PSG_NR11, PSG_NR12, PSG_NR13, PSG_NR14, PSG_NR21, PSG_NR22, PSG_NR23, PSG_NR24]) {
            this.write(off, 0);
          }
          for (const off of [PSG_NR30, PSG_NR31, PSG_NR32, PSG_NR33, PSG_NR34, PSG_NR41, PSG_NR42, PSG_NR43, PSG_NR44]) {
            this.write(off, 0);
          }
          this.write(PSG_NR50, 0);
          this.write(PSG_NR51, 0);
          this.sq1.on = this.sq2.on = this.wave.on = this.noise.on = false;
          this.regs.set(mirror);
        } else if (on && !this.master) {
          // On: the frame sequencer starts over (its next step is 0).
          this.seqStep = 7;
          this.seqCountdown = FRAME_SEQUENCER_CYCLES;
        }
        this.master = on;
        break;
      }
      case PSG_SOUNDBIAS_L:
        this.soundbias = (this.soundbias & 0xff00) | value;
        break;
      case PSG_SOUNDBIAS_H:
        this.soundbias = (this.soundbias & 0xff) | (value << 8);
        break;
    }
  }

  /** NRx4 bit 6. Enabling it in a step that doesn't clock the length counter clocks it once (mGBA). */
  private writeLengthEnable(ch: { length: number; lengthEnable: boolean; on: boolean }, enable: boolean, seqEven: boolean): void {
    const was = ch.lengthEnable;
    ch.lengthEnable = enable;
    if (!was && enable && ch.length && seqEven) {
      if (--ch.length === 0) ch.on = false;
    }
  }

  /** A restart with the length counter at 0 reloads it to its maximum. */
  private reloadLength(ch: { length: number; lengthEnable: boolean }, max: number, seqEven: boolean): void {
    if (ch.length) return;
    ch.length = max;
    if (ch.lengthEnable && seqEven) ch.length--;
  }

  /** The sweep's calculation (mGBA _updateSweep): `initial` only checks for an overflow; returns false when the
   *  frequency would pass 2047 (the channel goes off). */
  private updateSweep(initial: boolean): boolean {
    const s = this.sweep;
    if (initial || s.time !== 8) {
      let f = s.shadow;
      if (s.down) {
        f -= f >> s.shift;
        if (!initial && f >= 0) {
          this.sq1.freq = f;
          s.shadow = f;
        }
      } else {
        f += f >> s.shift;
        if (f >= 2048) return false;
        if (!initial && s.shift) {
          this.sq1.freq = f;
          s.shadow = f;
          if (!this.updateSweep(true)) return false;
        }
      }
      s.occurred = true;
    }
    s.step = s.time;
    return true;
  }

  /** The playing region of the wave RAM: its first sample and length. */
  private waveRegion(): [number, number] {
    const w = this.wave;
    return w.dimension ? [0, 64] : [w.bank * 32, 32];
  }

  /** Writes the playing region's rotation back into `ram` (before the region changes or the CPU writes into it). */
  private normalizeWave(): void {
    const w = this.wave;
    if (!w.rot) return;
    const [base, len] = this.waveRegion();
    const copy = w.ram.slice(base, base + len);
    for (let j = 0; j < len; j++) w.ram[base + j] = copy[(j + w.rot) % len];
    w.rot = 0;
  }

  /** A CPU write to the wave RAM: the bank NR30 bit 6 doesn't play (in 64-sample mode that one plays too). */
  private writeWaveRam(byte: number, value: number): void {
    const w = this.wave;
    if (w.dimension) this.normalizeWave();
    const at = (w.bank ? 0 : 32) + 2 * byte;
    w.ram[at] = value >> 4;
    w.ram[at + 1] = value & 15;
  }

  /** One frame sequencer step. */
  private clockSequencer(): void {
    const step = (this.seqStep = (this.seqStep + 1) & 7);
    if (step === 2 || step === 6) {
      const s = this.sweep;
      if (s.enable && --s.step === 0) {
        if (!this.updateSweep(false)) this.sq1.on = false;
      }
    }
    if (!(step & 1)) {
      for (const ch of [this.sq1, this.sq2, this.wave, this.noise]) {
        if (ch.length && ch.lengthEnable && --ch.length === 0) ch.on = false;
      }
    }
    if (step === 7) {
      if (this.sq1.on) clockEnvelope(this.sq1.env);
      if (this.sq2.on) clockEnvelope(this.sq2.env);
      if (this.noise.on) clockEnvelope(this.noise.env);
    }
  }

  /** A square over `cycles`: its average output (0-15). Off, the duty position still moves on. */
  private squareAverage(sq: Square, cycles: number): number {
    const period = 16 * (2048 - sq.freq);
    if (!sq.on || sq.env.volume === 0) {
      if (sq.timer > cycles) sq.timer -= cycles;
      else {
        const over = cycles - sq.timer;
        const k = Math.floor(over / period);
        sq.index = (sq.index + 1 + k) & 7;
        sq.timer = period - (over - k * period);
      }
      return 0;
    }
    const pattern = SQUARE_DUTY[sq.duty];
    let rem = cycles;
    let high = 0;
    for (;;) {
      if (sq.timer > rem) {
        if (pattern[sq.index]) high += rem;
        sq.timer -= rem;
        break;
      }
      if (pattern[sq.index]) high += sq.timer;
      rem -= sq.timer;
      sq.timer = period;
      sq.index = (sq.index + 1) & 7;
    }
    return (high / cycles) * sq.env.volume;
  }

  private waveAverage(cycles: number): number {
    const w = this.wave;
    if (!w.on) return 0;
    const period = 8 * (2048 - w.freq);
    const [base, len] = this.waveRegion();
    let rem = cycles;
    let acc = 0;
    for (;;) {
      const level = waveLevel(w.sample, w.volume);
      if (w.timer > rem) {
        acc += level * rem;
        w.timer -= rem;
        break;
      }
      acc += level * w.timer;
      rem -= w.timer;
      w.timer = period;
      // The RAM rotates by a sample: the one rotated out plays.
      w.sample = w.ram[base + w.rot];
      w.rot = (w.rot + 1) % len;
    }
    return acc / cycles;
  }

  private noiseAverage(cycles: number): number {
    const n = this.noise;
    if (!n.on) return 0;
    const period = noisePeriod(n);
    let rem = cycles;
    let high = 0;
    for (;;) {
      if (n.timer > rem) {
        if (n.out) high += rem;
        n.timer -= rem;
        break;
      }
      if (n.out) high += n.timer;
      rem -= n.timer;
      n.timer = period;
      clockLfsr(n);
    }
    return (high / cycles) * n.env.volume;
  }

  /**
   * Play `n` samples of `cyclesPerSample` cycles each, writing the PSG's level per side in the DAC's 10-bit units:
   * the routed channels' outputs (0-15 each) × 8 × (NR50's volume + 1), then SOUNDCNT_H's share (100%: / 4, 50%:
   * / 8, 25%: / 16), as mGBA's GBAudioSamplePSG and GBAAudioSample: a channel at 15 spans 240 of the 1,024 (GBATEK:
   * "each PSG a quarter of the output range"). The PSG's levels are unsigned (0 when silent).
   *
   * With `dacInterval` set (SoundCircuit), as the GBA: the DAC point-samples the PSG and holds it, so the fast
   * channels (noise at a high clock) alias at full level instead of averaging out (W-ref 2: SE_FLEE's noise was
   * 10 dB down against mGBA with the box filter); each output sample is the held signal's average over its cycles.
   */
  render(outL: Float32Array, outR: Float32Array, n: number, cyclesPerSample: number): void {
    if (!this.master) {
      outL.fill(0, 0, n);
      outR.fill(0, 0, n);
      return;
    }
    const interval = this.dacInterval;
    for (let i = 0; i < n; i++) {
      while (this.seqCountdown <= 0) {
        this.seqCountdown += FRAME_SEQUENCER_CYCLES;
        this.advance(this.pending);
        this.pending = 0;
        this.clockSequencer();
      }
      this.seqCountdown -= cyclesPerSample;
      if (interval === 0) {
        this.mix(
          this.squareAverage(this.sq1, cyclesPerSample),
          this.squareAverage(this.sq2, cyclesPerSample),
          this.waveAverage(cyclesPerSample),
          this.noiseAverage(cyclesPerSample),
        );
        outL[i] = this.heldL;
        outR[i] = this.heldR;
        continue;
      }
      // The held level changes only at the DAC's ticks, so the channels are moved on only there (and before the
      // frame sequencer's steps, and at the end): `pending` is how far they lag.
      let rem = cyclesPerSample;
      let accL = 0;
      let accR = 0;
      while (this.dacCountdown <= rem) {
        const c = this.dacCountdown;
        accL += this.heldL * c;
        accR += this.heldR * c;
        this.advance(this.pending + c);
        this.pending = 0;
        rem -= c;
        this.samplePoint();
        this.dacCountdown = interval;
      }
      accL += this.heldL * rem;
      accR += this.heldR * rem;
      this.pending += rem;
      this.dacCountdown -= rem;
      outL[i] = accL / cyclesPerSample;
      outR[i] = accR / cyclesPerSample;
    }
    this.advance(this.pending);
    this.pending = 0;
  }

  /** Moves every channel on by `cycles` (their *Average functions, the averages unused). */
  private advance(cycles: number): void {
    if (cycles <= 0) return;
    this.squareAverage(this.sq1, cycles);
    this.squareAverage(this.sq2, cycles);
    this.waveAverage(cycles);
    this.noiseAverage(cycles);
  }

  /** The DAC's point sample (mGBA's GBAudioSamplePSG): each channel's level now, into heldL / heldR. */
  private samplePoint(): void {
    const a = this.sq1;
    const b = this.sq2;
    const w = this.wave;
    const n = this.noise;
    this.mix(
      a.on ? SQUARE_DUTY[a.duty][a.index] * a.env.volume : 0,
      b.on ? SQUARE_DUTY[b.duty][b.index] * b.env.volume : 0,
      w.on ? waveLevel(w.sample, w.volume) : 0,
      n.on ? n.out * n.env.volume : 0,
    );
  }

  /** The channels' levels (0-15) routed by NR51, × 8 × (NR50 + 1), then SOUNDCNT_H's share: into heldL / heldR. */
  private mix(c1: number, c2: number, c3: number, c4: number): void {
    const nr51 = this.nr51;
    const right = (nr51 & 1 ? c1 : 0) + (nr51 & 2 ? c2 : 0) + (nr51 & 4 ? c3 : 0) + (nr51 & 8 ? c4 : 0);
    const left = (nr51 & 0x10 ? c1 : 0) + (nr51 & 0x20 ? c2 : 0) + (nr51 & 0x40 ? c3 : 0) + (nr51 & 0x80 ? c4 : 0);
    // SOUNDCNT_H bits 0-1: 0 25%, 1 50%, 2 100% (3 is prohibited: as 100%).
    const share = Math.min(this.soundcntH & 3, 2);
    const scale = 8 / (1 << (4 - share));
    this.heldL = left * scale * (this.volLeft + 1);
    this.heldR = right * scale * (this.volRight + 1);
  }
}
