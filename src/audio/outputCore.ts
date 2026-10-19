// The browser output's pure parts (AUDIO_PLAN.md W-out 1): when the output is on, the messages between
// output.ts and the AudioWorklet, the GBA's sound circuit (the DirectSound DAC, the PSG synth from psgSynth.ts,
// mixed as the GBA mixes them: SoundCircuit) and the sample-and-hold upsampler. No DOM and no Web Audio here, so
// the unit tests and the headless renderer import it (tests/unit/audioOutput.test.ts, tests/audioRender.ts) and
// the worklet bundles it.

import { GBA_CYCLES_PER_FRAME, PsgSynth } from './psgSynth';

/** Samples the m4a mixer writes per frame at SOUND_MODE_FREQ_13379 (gPcmSamplesPerVBlankTable[3]). */
export const PCM_SAMPLES_PER_VBLANK = 224;
/** The GBA's mixing rate: 224 samples per VBlank at 59.7275 Hz. */
export const GBA_PCM_FREQ = 13379;
/** The port's frame rate (OverworldScene.tick, GbaHostScene.update): one pushFrame per 60 Hz tick. */
export const PORT_FRAME_RATE = 60;
/**
 * The rate the output plays the PCM at: 224 samples per 60 Hz frame, 13,440 Hz. The GBA plays 13,379 Hz, but its
 * frame is 59.7275 Hz; the port's is 60 Hz, so playing 13,379 Hz would fall behind the frames it is given. The
 * output keeps the GBA's samples per frame instead (docs/DEVIATIONS.md: 0.46% higher, like all port timing).
 */
export const PCM_INPUT_RATE = PCM_SAMPLES_PER_VBLANK * PORT_FRAME_RATE;
/**
 * The sound circuit's output: 4 samples per FIFO sample (896 per frame), each the PSG's average over its 313.5
 * cycles plus the FIFO sample it holds. The GBA's DAC runs at 65,536 Hz (SOUNDBIAS_H 0x40: 8 bits); this keeps a
 * whole number of samples per FIFO sample instead (docs/DEVIATIONS.md).
 */
export const DAC_OVERSAMPLE = 4;
export const DAC_SAMPLES_PER_FRAME = PCM_SAMPLES_PER_VBLANK * DAC_OVERSAMPLE;
/** The rate the output plays the circuit's samples at (53,760 Hz: 896 per 60 Hz frame). */
export const DAC_RATE = PCM_INPUT_RATE * DAC_OVERSAMPLE;
/** The same samples at the GBA's speed (53,516 Hz: 896 per 59.7275 Hz frame), for WAV files. */
export const GBA_DAC_RATE = GBA_PCM_FREQ * DAC_OVERSAMPLE;

// REG_SOUNDCNT_H bits (include/gba/io_reg.h).
export const SOUND_CGB_MIX_FULL = 0x0002;
export const SOUND_A_MIX_FULL = 0x0004;
export const SOUND_B_MIX_FULL = 0x0008;
export const SOUND_ALL_MIX_FULL = 0x000e;
export const SOUND_A_RIGHT_OUTPUT = 0x0100;
export const SOUND_A_LEFT_OUTPUT = 0x0200;
export const SOUND_B_RIGHT_OUTPUT = 0x1000;
export const SOUND_B_LEFT_OUTPUT = 0x2000;
/** SoundInit / SetPokemonCryStereo(1) (m4a.c): FIFO A (the first half of pcmBuffer) right, FIFO B left, full. */
export const SOUNDCNT_H_STEREO = SOUND_B_LEFT_OUTPUT | SOUND_A_RIGHT_OUTPUT | SOUND_ALL_MIX_FULL;
/** SetPokemonCryStereo(0) (m4a.c): both FIFOs to both speakers at half volume. */
export const SOUNDCNT_H_MONO =
  SOUND_B_LEFT_OUTPUT | SOUND_B_RIGHT_OUTPUT | SOUND_A_LEFT_OUTPUT | SOUND_A_RIGHT_OUTPUT | SOUND_CGB_MIX_FULL;

// ------------------------------------------------------------------ when the output is on

export type OutputReason = 'flag' | 'headless' | 'speed' | 'default' | 'unsupported';

export interface OutputDecision {
  enabled: boolean;
  /** Why: `?audio=` (flag), a headless browser, `?speed=` > 1, or neither (default). */
  reason: OutputReason;
  /** `?audio=tone` (dev builds): play the test tone. */
  tone: boolean;
}

/**
 * AUDIO_PLAN.md section 4, "The browser": the output is off in a headless browser and for `?speed=` > 1
 * (dev builds; the engine still runs); `?audio=0` / `?audio=1` force it off / on, `?audio=tone` (dev) is on with
 * the test tone.
 */
export function decideOutput(search: string, opts: { headless: boolean; dev: boolean }): OutputDecision {
  const q = new URLSearchParams(search);
  const flag = q.get('audio');
  const tone = opts.dev && flag === 'tone';
  if (flag === '0' || flag === 'false' || flag === 'off') return { enabled: false, reason: 'flag', tone: false };
  if (flag === '1' || flag === 'true' || flag === 'on' || tone) return { enabled: true, reason: 'flag', tone };
  if (opts.headless) return { enabled: false, reason: 'headless', tone: false };
  // Parsed as testHooks parses it (dev builds only): the logic ticks per frame.
  const speed = opts.dev && q.has('speed') ? Math.max(1, Math.floor(Number(q.get('speed')) || 1)) : 1;
  if (speed > 1) return { enabled: false, reason: 'speed', tone: false };
  return { enabled: true, reason: 'default', tone: false };
}

/**
 * A headless or automated browser: navigator.webdriver (WebDriver, Puppeteer), or headless Chrome's user agent
 * (the e2e harness drives Chrome over the DevTools protocol, where navigator.webdriver is false).
 */
export function isHeadlessBrowser(nav: { webdriver?: boolean; userAgent: string }): boolean {
  return nav.webdriver === true || /\bHeadlessChrome\//.test(nav.userAgent);
}

// ------------------------------------------------------------------ messages (output.ts <-> worklet.ts)

export const WORKLET_NAME = 'gba-sound-output';

/** output.ts → worklet: one frame of sound. `pcm` holds FIFO A's samples then FIFO B's (Int8, n each). */
export interface FrameMessage {
  type: 'frame';
  pcm: ArrayBuffer;
  soundcntH: number;
  /** The PSG's register writes (PsgFrame.writes in soundRegs.ts: a Uint16Array's buffer), which the worklet's
   *  SoundCircuit replays. Without them (the dev test tone) the PSG is silent. */
  psg?: ArrayBuffer;
  /** PsgFrame.state (a Uint8Array's buffer, PSG_STATE_SIZE bytes): the registers before `psg`. */
  psgState?: ArrayBuffer;
}
export type ToWorklet = FrameMessage | { type: 'mute'; muted: boolean } | { type: 'flush' };

/** worklet → output.ts, a few times a second. */
export interface OutputStats {
  /** Frames received. */
  frames: number;
  /** Times the buffer ran dry while playing (each plays silence until it refills). */
  underruns: number;
  /** Frames dropped because the buffer ran over (after a stall: the host ticks up to 5 frames at once). */
  dropped: number;
  /** Input samples buffered now. */
  buffered: number;
  /** The largest |sample| written to the speakers since the last report (0 while muted). */
  peak: number;
  /** Output samples written since the worklet started. */
  rendered: number;
}
export type FromWorklet = { type: 'stats'; stats: OutputStats };

// ------------------------------------------------------------------ the DAC

/**
 * The GBA's sound mixer for one speaker's DirectSound part (GBATEK "Sound Control Registers"): each FIFO routed to
 * this speaker adds its signed 8-bit sample ×4 at 100% or ×2 at 50% (the 10-bit scale). The PSG adds in the same
 * units (PsgSynth.render).
 */
export function directSoundLevel(a: number, b: number, soundcntH: number, left: boolean): number {
  let sum = 0;
  if (soundcntH & (left ? SOUND_A_LEFT_OUTPUT : SOUND_A_RIGHT_OUTPUT)) sum += a * (soundcntH & SOUND_A_MIX_FULL ? 4 : 2);
  if (soundcntH & (left ? SOUND_B_LEFT_OUTPUT : SOUND_B_RIGHT_OUTPUT)) sum += b * (soundcntH & SOUND_B_MIX_FULL ? 4 : 2);
  return sum;
}

/** REG_SOUNDBIAS as SoundInit leaves it: the bias 0x200, resolution 1 (8 bits at 65,536 Hz). */
export const SOUNDBIAS_DEFAULT = 0x4200;

/**
 * The DAC: the 10-bit sum (rounded down) plus SOUNDBIAS's bias (0x200), clipped to 0..0x3FF, at SOUNDBIAS's
 * amplitude resolution (bits 14-15: 0 9 bits, 1 8 bits (SoundInit's 0x40 in SOUNDBIAS_H: the two low bits drop),
 * 2 7 bits, 3 6 bits), as a float in [-1, 1) around the middle (0x200).
 */
export function dacOutput(level10: number, soundbias = SOUNDBIAS_DEFAULT): number {
  const drop = ((soundbias >> 14) & 3) + 1;
  const biased = Math.min(Math.max(Math.floor(level10) + (soundbias & 0x3fe), 0), 0x3ff);
  return (((biased >> drop) << drop) - 0x200) / 0x200;
}

/** One frame's FIFO samples → speaker samples (floats), as the DAC outputs them. */
export function frameToDac(fifoA: Int8Array, fifoB: Int8Array, soundcntH: number, outL: Float32Array, outR: Float32Array): void {
  for (let i = 0; i < fifoA.length; i++) {
    outL[i] = dacOutput(directSoundLevel(fifoA[i], fifoB[i], soundcntH, true));
    outR[i] = dacOutput(directSoundLevel(fifoA[i], fifoB[i], soundcntH, false));
  }
}

// ------------------------------------------------------------------ the sound circuit (FIFOs + PSG)

/** One frame's PSG part as the worklet gets it (PsgFrame in soundRegs.ts). */
export interface PsgInput {
  writes: Uint16Array;
  state: Uint8Array;
}

/**
 * The GBA's sound circuit for one frame at a time: the PSG (PsgSynth) driven by the frame's register writes, and the
 * FIFOs, summed per speaker in the 10-bit scale and through the DAC (dacOutput), DAC_OVERSAMPLE samples per FIFO
 * sample.
 *
 * Timing (docs/DEV_NOTES.md "PSG frames", gotcha 1): CgbSound writes the PSG registers in VBlank, where they take
 * effect at once, but the FIFO samples SoundMainRAM mixes in the same VBlank play during the *next* frame. So each
 * frame plays the previous frame's FIFO samples (held back here) with this frame's PSG writes, all applied in
 * order at the frame's start (CgbSound runs in the first lines of VBlank; the game logic's CgbOscOff writes came a
 * little earlier).
 *
 * Picking up: the first frame, a frame after `reset()` (the output flushed) and any frame whose `state` isn't what
 * the writes so far left (frames went missing) load `state` first: channels started before then stay silent until
 * their next restart.
 */
export class SoundCircuit {
  readonly psg = new PsgSynth();
  /** Play the PSG (false: the FIFOs only, for comparisons). */
  psgOn = true;
  private synced = false;
  private heldA = new Int8Array(PCM_SAMPLES_PER_VBLANK);
  private heldB = new Int8Array(PCM_SAMPLES_PER_VBLANK);
  private psgL = new Float32Array(DAC_SAMPLES_PER_FRAME);
  private psgR = new Float32Array(DAC_SAMPLES_PER_FRAME);

  /** Start over: the held FIFO samples are dropped and the next frame's `state` is loaded. */
  reset(): void {
    this.synced = false;
    this.heldA.fill(0);
    this.heldB.fill(0);
  }

  /**
   * One frame: `fifoA` / `fifoB` (n samples each) are held for the next frame; the speakers get the held ones and
   * the PSG, n × DAC_OVERSAMPLE samples per side in `outL` / `outR`.
   */
  frame(fifoA: Int8Array, fifoB: Int8Array, soundcntH: number, psg: PsgInput | undefined, outL: Float32Array, outR: Float32Array): void {
    const n = fifoA.length;
    const out = n * DAC_OVERSAMPLE;
    if (this.heldA.length !== n) {
      this.heldA = new Int8Array(n);
      this.heldB = new Int8Array(n);
    }
    if (this.psgL.length < out) {
      this.psgL = new Float32Array(out);
      this.psgR = new Float32Array(out);
    }
    let cntH = soundcntH;
    let soundbias = SOUNDBIAS_DEFAULT;
    const synth = this.psg;
    if (psg) {
      if (!this.synced || !synth.matchesState(psg.state)) synth.loadState(psg.state);
      this.synced = true;
      for (let i = 0; i < psg.writes.length; i++) synth.write(psg.writes[i] >> 8, psg.writes[i] & 0xff);
      cntH = synth.soundcntH;
      soundbias = synth.soundbias;
      // The GBA's DAC point-samples the PSG at SOUNDBIAS's rate (65,536 Hz for FRLG) and holds it.
      synth.dacInterval = 0x200 >> ((soundbias >> 14) & 3);
      synth.render(this.psgL, this.psgR, out, GBA_CYCLES_PER_FRAME / out);
      if (!this.psgOn) {
        this.psgL.fill(0);
        this.psgR.fill(0);
      }
    } else {
      this.synced = false;
      this.psgL.fill(0);
      this.psgR.fill(0);
    }
    const heldA = this.heldA;
    const heldB = this.heldB;
    for (let j = 0, i = 0; j < n; j++) {
      const l = directSoundLevel(heldA[j], heldB[j], cntH, true);
      const r = directSoundLevel(heldA[j], heldB[j], cntH, false);
      for (let k = 0; k < DAC_OVERSAMPLE; k++, i++) {
        outL[i] = dacOutput(l + this.psgL[i], soundbias);
        outR[i] = dacOutput(r + this.psgR[i], soundbias);
      }
    }
    heldA.set(fifoA);
    heldB.set(fifoB.subarray(0, n));
  }
}

// ------------------------------------------------------------------ the buffer and the upsampler

export interface ResamplerOptions {
  /** Input samples per frame (224). */
  frameLength?: number;
  /** Start (and restart after an underrun) once this many frames are buffered. */
  startFrames?: number;
  /** The fill the rate control aims for, on average, in frames. */
  targetFrames?: number;
  /** A push that would pass this many frames drops the oldest samples back to the target. */
  maxFrames?: number;
}

/**
 * A FIFO of speaker samples at the input rate, read out at the output rate by sample-and-hold, as the GBA's DAC
 * holds each sample until the timer moves the FIFO on (AUDIO_PLAN.md decision 8: no smoothing). Each output
 * sample is the input sample at floor(position), and the position steps by inRate / outRate.
 *
 * The frames come from the page's frame loop and are played on the audio clock, so the two drift a little (and the
 * loop stalls now and then): a 3-4 frame buffer absorbs the jitter, the step is nudged by at most ±0.5% to keep the
 * buffer near its target, an empty buffer plays silence until it is refilled, and an overfull one drops its oldest
 * samples.
 */
export class SampleHoldResampler {
  readonly frameLength: number;
  readonly startSamples: number;
  readonly targetSamples: number;
  readonly maxSamples: number;
  private readonly baseStep: number;
  private readonly bufL: Float32Array;
  private readonly bufR: Float32Array;
  /** Index of the oldest buffered sample, and how many there are. */
  private head = 0;
  private count = 0;
  /** Fraction of the oldest sample already played (sample-and-hold position). */
  private frac = 0;
  private playing = false;
  frames = 0;
  underruns = 0;
  dropped = 0;

  constructor(inRate: number, outRate: number, opts: ResamplerOptions = {}) {
    this.frameLength = opts.frameLength ?? PCM_SAMPLES_PER_VBLANK;
    this.startSamples = (opts.startFrames ?? 3) * this.frameLength;
    this.targetSamples = Math.round((opts.targetFrames ?? 3.5) * this.frameLength);
    this.maxSamples = (opts.maxFrames ?? 7) * this.frameLength;
    this.baseStep = inRate / outRate;
    const capacity = this.maxSamples + this.frameLength * 2;
    this.bufL = new Float32Array(capacity);
    this.bufR = new Float32Array(capacity);
  }

  get buffered(): number {
    return this.count;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Append a frame's speaker samples. */
  push(l: Float32Array, r: Float32Array): void {
    const n = l.length;
    this.frames++;
    if (this.count + n > this.maxSamples) {
      const drop = Math.min(this.count, this.count + n - this.targetSamples);
      this.head = (this.head + drop) % this.bufL.length;
      this.count -= drop;
      this.frac = 0;
      this.dropped++;
    }
    const cap = this.bufL.length;
    let w = (this.head + this.count) % cap;
    for (let i = 0; i < n; i++) {
      this.bufL[w] = l[i];
      this.bufR[w] = r[i];
      if (++w === cap) w = 0;
    }
    this.count += n;
  }

  /** Drop everything buffered (the tab came back after being hidden). */
  flush(): void {
    this.head = 0;
    this.count = 0;
    this.frac = 0;
    this.playing = false;
  }

  /** The step for this block: the base ratio, nudged toward the target fill (0.5% per frame off, ±0.5% at most). */
  step(): number {
    const off = (this.count - this.targetSamples) / this.frameLength;
    return this.baseStep * (1 + Math.min(0.005, Math.max(-0.005, 0.005 * off)));
  }

  /** Fill one output block; silence while not playing. Returns the largest |sample| written. */
  render(outL: Float32Array, outR: Float32Array): number {
    const n = outL.length;
    if (!this.playing && this.count >= this.startSamples) this.playing = true;
    if (!this.playing) {
      outL.fill(0);
      outR.fill(0);
      return 0;
    }
    const step = this.step();
    const cap = this.bufL.length;
    let peak = 0;
    let pos = this.frac;
    let i = 0;
    for (; i < n; i++) {
      const k = Math.floor(pos);
      if (k >= this.count) break;
      const at = (this.head + k) % cap;
      const l = this.bufL[at];
      const r = this.bufR[at];
      outL[i] = l;
      outR[i] = r;
      const m = Math.max(Math.abs(l), Math.abs(r));
      if (m > peak) peak = m;
      pos += step;
    }
    const used = Math.min(Math.floor(pos), this.count);
    this.head = (this.head + used) % cap;
    this.count -= used;
    this.frac = pos - Math.floor(pos);
    if (i < n) {
      // Underrun: the rest of the block is silent and playback waits for the buffer to refill.
      outL.fill(0, i);
      outR.fill(0, i);
      this.underruns++;
      this.playing = false;
      this.frac = 0;
    }
    return peak;
  }
}
