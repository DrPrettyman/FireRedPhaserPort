// The browser's sound output (AUDIO_PLAN.md W-out 1, section 4 "The browser"): an AudioContext with one
// AudioWorkletNode (worklet.ts) that plays the frames the m4a mixer hands to pushFrame.
//
// - Created at boot (startAudioOutput, from main.ts and battleTest.ts); the browser keeps it suspended until the
//   first keydown / pointerdown (input/Input.ts listenForOutputKeys), which resumes it. Suspended while the tab
//   is hidden (Phaser stops the frame loop then, so no frames would come).
// - Off in a headless browser (isHeadlessBrowser) and for `?speed=` > 1; `?audio=0` / `?audio=1` force it, `?audio=tone`
//   (dev) plays a test tone through pushFrame's path (decideOutput in outputCore.ts).
// - M toggles all output (decision 10): the worklet writes silence, the frames still flow. Remembered in
//   localStorage, not in the save.
//
// Determinism: the m4a engine runs the same with the output on or off; nothing outside this file may read the
// AudioContext or branch on whether the output is on (AUDIO_PLAN.md "Rules"). The one exception is
// audioOutputWantsFrames, for the mixer to skip its sample arithmetic (not its bookkeeping) when nobody listens.

import workletUrl from './worklet.ts?worker&url';
import {
  decideOutput,
  isHeadlessBrowser,
  PCM_INPUT_RATE,
  PCM_SAMPLES_PER_VBLANK,
  PORT_FRAME_RATE,
  SOUNDCNT_H_STEREO,
  WORKLET_NAME,
  type FrameMessage,
  type FromWorklet,
  type OutputDecision,
  type OutputStats,
  type ToWorklet,
} from './outputCore';

/**
 * The PSG part of a frame: TODO W-m4a 4 (the shape is a proposal; W-m4a 4 owns it). The sound register writes
 * CgbSound, CgbOscOff and ply_port made during the frame, in order, each `offset << 8 | value` with the offset
 * from REG_SOUND1CNT_L (0x4000060, as gSoundInfo.soundRegs), covering NR10-NR52, SOUNDCNT_L / SOUNDCNT_X and the
 * wave RAM. Writes rather than a snapshot because a trigger (NRx4 bit 7) is an event: the worklet applies them
 * at the frame's start and runs the channels (envelopes, length counters, sweep, the noise LFSR) for the frame.
 */
export interface PsgFrame {
  writes: Uint16Array;
}

/**
 * One frame of sound, what SoundMainRAM leaves in the DMA buffer for the next VBlank: `pcmSamplesPerVBlank` (224)
 * signed 8-bit samples for each FIFO. On the GBA FIFO A reads soundInfo->pcmBuffer and FIFO B pcmBuffer +
 * PCM_DMA_BUF_SIZE (SoundInit), so in stereo A is the right speaker and B the left; mono (soundInfo->mode bit 0)
 * routes both to both at half volume. The arrays are copied, so the mixer may reuse them.
 */
export interface SoundFrame {
  fifoA: Int8Array;
  fifoB: Int8Array;
  /** REG_SOUNDCNT_H: the FIFOs' routing and volumes (SOUNDCNT_H_STEREO, the default, or SOUNDCNT_H_MONO). */
  soundcntH?: number;
  /** TODO W-m4a 4: the frame's PSG register writes. */
  psg?: PsgFrame;
}

/** localStorage key of the mute key's setting ('1' muted). */
export const MUTE_STORAGE_KEY = 'firered-phaser:audio-muted';

let started = false;
let decision: OutputDecision = { enabled: false, reason: 'default', tone: false };
let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
/** A keydown / pointerdown has happened: the browser lets the context run. */
let unlocked = false;
let muted = loadMuted();
let stats: OutputStats | null = null;
let error: string | null = null;
let toneOn = false;

function loadMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(): void {
  try {
    globalThis.localStorage?.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Storage blocked (private mode, sandboxed frame): the setting lasts until reload.
  }
}

function post(msg: ToWorklet, transfer: Transferable[] = []): void {
  node?.port.postMessage(msg, transfer);
}

/** The keys the output needs: input/Input.ts listenForOutputKeys (passed in, so this file doesn't load Phaser). */
export type OutputKeyListener = (handlers: { gesture: () => void; toggleMute: () => void }) => void;

/**
 * Boot: decide whether the output is on, create the context and load the worklet, listen for the keys
 * (`startAudioOutput(listenForOutputKeys)` from main.ts and battleTest.ts).
 */
export function startAudioOutput(listenForKeys: OutputKeyListener): void {
  if (started) return;
  started = true;
  listenForKeys({ gesture: onGesture, toggleMute });
  decision = decideOutput(location.search, { headless: isHeadlessBrowser(navigator), dev: import.meta.env.DEV });
  if (!decision.enabled) return;
  if (typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
    decision = { enabled: false, reason: 'unsupported', tone: false };
    return;
  }
  // Without a user gesture yet the browser creates it suspended (autoplay policy); onGesture resumes it.
  ctx = new AudioContext({ latencyHint: 'interactive' });
  document.addEventListener('visibilitychange', onVisibilityChange);
  void loadWorklet(ctx);
  if (decision.tone) setTestTone(true);
}

async function loadWorklet(c: AudioContext): Promise<void> {
  try {
    await c.audioWorklet.addModule(workletUrl);
    const n = new AudioWorkletNode(c, WORKLET_NAME, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    n.port.onmessage = (e: MessageEvent<FromWorklet>) => {
      if (e.data.type === 'stats') stats = e.data.stats;
    };
    n.connect(c.destination);
    node = n;
    post({ type: 'mute', muted });
  } catch (err) {
    error = String(err);
    console.warn('[audio] the output could not start:', err);
  }
}

function onGesture(): void {
  unlocked = true;
  if (ctx?.state === 'suspended' && !document.hidden) void ctx.resume().catch(() => {});
}

function toggleMute(): void {
  muted = !muted;
  saveMuted();
  post({ type: 'mute', muted });
}

function onVisibilityChange(): void {
  if (!ctx) return;
  if (document.hidden) {
    // Also while a resume is still pending: the suspend queues behind it.
    if (ctx.state !== 'closed') void ctx.suspend().catch(() => {});
  } else if (unlocked && ctx.state === 'suspended') {
    // What was buffered when the tab was hidden is stale by now.
    post({ type: 'flush' });
    void ctx.resume().catch(() => {});
  }
}

function running(): boolean {
  return node !== null && ctx?.state === 'running';
}

/**
 * True while the output plays the frames it is given. Only for the mixer (W-m4a 3), to skip writing samples
 * nobody hears; the engine's state must advance the same either way.
 */
export function audioOutputWantsFrames(): boolean {
  return running() && !toneOn;
}

/**
 * Hand the output one frame of sound (the m4a mixer, W-m4a 3, once per frame after SoundMainRAM). A no-op while
 * the output is off, suspended, still loading, or playing the test tone.
 */
export function pushFrame(frame: SoundFrame): void {
  if (toneOn) return;
  postFrame(frame);
}

function postFrame(frame: SoundFrame): void {
  if (!running()) return;
  const n = frame.fifoA.length;
  const pcm = new ArrayBuffer(n * 2);
  new Int8Array(pcm, 0, n).set(frame.fifoA);
  new Int8Array(pcm, n, n).set(frame.fifoB.subarray(0, n));
  const msg: FrameMessage = { type: 'frame', pcm, soundcntH: frame.soundcntH ?? SOUNDCNT_H_STEREO };
  const transfer: Transferable[] = [pcm];
  if (frame.psg) {
    msg.psg = frame.psg.writes.slice().buffer;
    transfer.push(msg.psg);
  }
  post(msg, transfer);
}

// ------------------------------------------------------------------ dev: the test tone

let toneRaf = 0;
let toneLast = 0;
let toneAcc = 0;
let toneFrame = 0;
let tonePhase = 0;

/**
 * Dev only: play a test tone through the same path as the mixer's frames (pushFrame's message, the worklet's DAC
 * and upsampler), ticked at 60 Hz from requestAnimationFrame like the scene hosts. A square wave alternating A4 and
 * E5 every half second, in both FIFOs. Returns whether it is on.
 */
export function setTestTone(on: boolean): boolean {
  if (!import.meta.env.DEV || !ctx) return false;
  if (on === toneOn) return toneOn;
  toneOn = on;
  if (on) {
    toneLast = performance.now();
    toneAcc = 0;
    toneRaf = requestAnimationFrame(toneTick);
  } else cancelAnimationFrame(toneRaf);
  return toneOn;
}

function toneTick(now: number): void {
  if (!toneOn) return;
  const frameMs = 1000 / PORT_FRAME_RATE;
  toneAcc = Math.min(toneAcc + (now - toneLast), frameMs * 5);
  toneLast = now;
  while (toneAcc >= frameMs) {
    toneAcc -= frameMs;
    const freq = Math.floor(toneFrame++ / 30) % 2 ? 659.25 : 440;
    const pcm = new Int8Array(PCM_SAMPLES_PER_VBLANK);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = tonePhase < 0.5 ? 40 : -40;
      tonePhase = (tonePhase + freq / PCM_INPUT_RATE) % 1;
    }
    postFrame({ fifoA: pcm, fifoB: pcm });
  }
  toneRaf = requestAnimationFrame(toneTick);
}

// ------------------------------------------------------------------ probe (dev hooks, docs)

export interface AudioOutputProbe {
  enabled: boolean;
  reason: OutputDecision['reason'];
  /** The AudioContext's state, or 'none' when the output is off. */
  context: AudioContextState | 'none';
  unlocked: boolean;
  /** The worklet is loaded and connected. */
  ready: boolean;
  muted: boolean;
  tone: boolean;
  sampleRate: number;
  /** The worklet's last report (a few times a second while the context runs). */
  stats: OutputStats | null;
  error: string | null;
}

export function audioOutputProbe(): AudioOutputProbe {
  return {
    enabled: decision.enabled,
    reason: decision.reason,
    context: ctx ? ctx.state : 'none',
    unlocked,
    ready: node !== null,
    muted,
    tone: toneOn,
    sampleRate: ctx?.sampleRate ?? 0,
    stats,
    error,
  };
}
