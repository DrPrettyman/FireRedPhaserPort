// The AudioWorklet half of the output (AUDIO_PLAN.md decision 3): output.ts posts each frame's FIFO samples and
// PSG register writes on the node's MessagePort; this processor turns them into speaker samples as the GBA's sound
// circuit would (SoundCircuit: the PSG synth and the FIFOs through the DAC, 896 samples a frame), buffers 3-4
// frames and plays them in the context's rate by sample-and-hold (SampleHoldResampler). Loaded with
// `audioWorklet.addModule` from the URL Vite gives `./worklet.ts?worker&url` (bundled in dev and in the build).

import {
  DAC_OVERSAMPLE,
  DAC_RATE,
  DAC_SAMPLES_PER_FRAME,
  SampleHoldResampler,
  SoundCircuit,
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
  private resampler = new SampleHoldResampler(DAC_RATE, sampleRate, { frameLength: DAC_SAMPLES_PER_FRAME });
  private circuit = new SoundCircuit();
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
        const out = n * DAC_OVERSAMPLE;
        if (this.frameL.length !== out) {
          this.frameL = new Float32Array(out);
          this.frameR = new Float32Array(out);
        }
        const psg = m.psg && m.psgState ? { writes: new Uint16Array(m.psg), state: new Uint8Array(m.psgState) } : undefined;
        this.circuit.frame(fifoA, fifoB, m.soundcntH, psg, this.frameL, this.frameR);
        this.resampler.push(this.frameL, this.frameR);
        break;
      }
      case 'mute':
        this.muted = m.muted;
        break;
      case 'flush':
        this.resampler.flush();
        this.circuit.reset();
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
