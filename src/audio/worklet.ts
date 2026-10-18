// The AudioWorklet half of the output (AUDIO_PLAN.md decision 3): output.ts posts each frame's FIFO samples on
// the node's MessagePort; this processor turns them into speaker samples as the GBA's DAC would (frameToDac),
// buffers 3-4 frames and plays them upsampled by sample-and-hold (SampleHoldResampler). Loaded with
// `audioWorklet.addModule` from the URL Vite gives `./worklet.ts?worker&url` (bundled in dev and in the build).
//
// TODO W-m4a 4b: the PSG. The frame message carries the frame's PSG register writes (`psg`, `psgState`: see
// PsgFrame in soundRegs.ts and docs/DEV_NOTES.md "PSG frames"); the four channels
// (squares with duty and sweep, the wave channel, noise, the hardware envelope and length counters) are
// synthesized here at the output rate and added in the DAC's 10-bit units before dacOutput.

import {
  frameToDac,
  PCM_INPUT_RATE,
  SampleHoldResampler,
  WORKLET_NAME,
  type FromWorklet,
  type ToWorklet,
} from './outputCore';

// AudioWorkletGlobalScope (not in TypeScript's DOM lib).
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
declare const sampleRate: number;

/** Render quanta (128 samples each) between stats reports: ~0.17 s at 48 kHz. */
const STATS_EVERY = 64;

class GbaSoundOutputProcessor extends AudioWorkletProcessor {
  private resampler = new SampleHoldResampler(PCM_INPUT_RATE, sampleRate);
  private muted = false;
  private frameL = new Float32Array(0);
  private frameR = new Float32Array(0);
  private quanta = 0;
  private peak = 0;
  private rendered = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.receive(e.data);
  }

  private receive(m: ToWorklet): void {
    switch (m.type) {
      case 'frame': {
        const n = m.pcm.byteLength >> 1;
        const fifoA = new Int8Array(m.pcm, 0, n);
        const fifoB = new Int8Array(m.pcm, n, n);
        if (this.frameL.length !== n) {
          this.frameL = new Float32Array(n);
          this.frameR = new Float32Array(n);
        }
        frameToDac(fifoA, fifoB, m.soundcntH, this.frameL, this.frameR);
        this.resampler.push(this.frameL, this.frameR);
        break;
      }
      case 'mute':
        this.muted = m.muted;
        break;
      case 'flush':
        this.resampler.flush();
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const l = out[0];
    const r = out[1] ?? out[0];
    // Muted, the buffer still plays out (into nothing), so unmuting picks up where the frames are.
    const peak = this.resampler.render(l, r);
    if (this.muted) {
      l.fill(0);
      r.fill(0);
    } else if (peak > this.peak) this.peak = peak;
    this.rendered += l.length;
    if (++this.quanta % STATS_EVERY === 0) this.report();
    return true;
  }

  private report(): void {
    const r = this.resampler;
    const msg: FromWorklet = {
      type: 'stats',
      stats: { frames: r.frames, underruns: r.underruns, dropped: r.dropped, buffered: r.buffered, peak: this.peak, rendered: this.rendered },
    };
    this.port.postMessage(msg);
    this.peak = 0;
  }
}

registerProcessor(WORKLET_NAME, GbaSoundOutputProcessor);
