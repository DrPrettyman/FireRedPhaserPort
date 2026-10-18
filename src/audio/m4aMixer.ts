// SoundMainRAM (m4a_1.s:88), the DirectSound half of each frame: the reverb pass over this frame's slot of
// pcmBuffer, then per channel the envelope (attack / decay / sustain / release and the pseudo echo, once per frame)
// and the frame's 224 output samples: the pitch step, the loop, the end of a non-looping sample, the reverse start
// (SoundMainRAM_Unk1), and the mix: each sample (interpolated between two source samples by `fw`, except for the
// fixed-rate voices) scaled by envelopeVolumeRight into FIFO A's half of the buffer and by envelopeVolumeLeft into
// FIFO B's, added with 8-bit wraparound as the asm's byte lanes do.
//
// The bookkeeping (envelopes, positions, loop and end) always runs: a channel lives exactly as long as on the GBA
// (a cry's sample running out is what ends IsPokemonCryPlaying early). Writing samples is optional
// (m4aSetMixing: audio/frame.ts turns it on while the output wants frames, and tests); without it each channel's
// frame takes the FastForward shortcut when it can, and the buffer slot is cleared. Nothing here reads the
// AudioContext or a clock.
//
// Mono (soundInfo->mode bit 0, SetPokemonCryStereo) isn't read here: FRLG's mixer always writes FIFO A (right)
// and FIFO B (left); mono is REG_SOUNDCNT_H routing both FIFOs to both speakers at half volume (the output's DAC,
// outputCore.ts) and CgbSound's pan (W-m4a 4). No DPCM: the cry samples are PCM already (AUDIO_PLAN.md decision 4).

import {
  SOUND_CHANNEL_SF_ENV,
  SOUND_CHANNEL_SF_ENV_ATTACK,
  SOUND_CHANNEL_SF_ENV_DECAY,
  SOUND_CHANNEL_SF_IEC,
  SOUND_CHANNEL_SF_LOOP,
  SOUND_CHANNEL_SF_ON,
  SOUND_CHANNEL_SF_SPECIAL,
  SOUND_CHANNEL_SF_START,
  SOUND_CHANNEL_SF_STOP,
  PCM_DMA_BUF_SIZE,
  TONEDATA_TYPE_CMP,
  TONEDATA_TYPE_FIX,
  TONEDATA_TYPE_REV,
  WAVE_DATA_FLAG_LOOP,
  u8,
  type SoundChannel,
  type SoundInfo,
  type ToneWav,
  type WaveData,
} from './m4aInternal';

/** A DirectSound channel's `wav` is a WaveData (the other ToneWav kinds belong to CGB or keysplit voices). */
export function isWaveData(wav: ToneWav): wav is WaveData {
  return typeof wav === 'object' && wav !== null && !Array.isArray(wav) && !(wav instanceof Uint8Array);
}

/** One sample step is 2^23 in `fw`'s units: a FIX (no-resample) voice moves one sample per output sample. */
const FW_ONE = 0x800000;

/** Whether SoundMainRAM writes samples (see the top of the file). */
let gMixPcm = false;

/**
 * Turns the mixing on or off (audio/frame.ts, each frame, from audioOutputWantsFrames; tests). Only the samples
 * written depend on it: every channel's envelope, position, loop and end advance the same either way.
 */
export function m4aSetMixing(on: boolean): void {
  gMixPcm = on;
}

/** The offset in pcmBuffer of the slot SoundMain mixes into this frame (m4a_1.s SoundMain_5's r5): the DMA plays
 *  pcmDmaPeriod (7) slots of 224 samples in a ring, restarting at slot 0 when m4aSoundVSync reloads the counter,
 *  so with the counter at c the mix goes to slot period + 1 - c (slot 0 for c <= 1) and plays the next frame. */
export function PcmSlotOffset(soundInfo: SoundInfo): number {
  const c = soundInfo.pcmDmaCounter;
  if (c <= 1) return 0;
  return (soundInfo.pcmDmaPeriod - (c - 1)) * soundInfo.pcmSamplesPerVBlank;
}

/** The current channel's mix (module state, so the per-sample loops allocate nothing): its sample data, or null
 *  when nothing is written; the slot's offset in pcmBuffer (FIFO A, FIFO B at + PCM_DMA_BUF_SIZE); its volumes. */
let mixData: Int8Array | null = null;
let mixBuf: Int8Array = new Int8Array(0);
let mixSlot = 0;
let mixVolR = 0;
let mixVolL = 0;

/** SoundMainRAM (m4a_1.s:88): the reverb pass (or the clearing), then the DirectSound channels' frame. */
export function SoundMainRAM(soundInfo: SoundInfo): void {
  const samples = soundInfo.pcmSamplesPerVBlank;
  const divFreq = soundInfo.divFreq;
  const slot = PcmSlotOffset(soundInfo);
  const buf = soundInfo.pcmBuffer;
  const mixing = gMixPcm;
  if (mixing && soundInfo.reverb !== 0) SoundMainRAM_Reverb(soundInfo, slot);
  else SoundMainRAM_NoReverb(buf, slot, samples);
  mixBuf = buf;
  mixSlot = slot;
  for (let i = 0; i < soundInfo.maxChans; i++) {
    const chan = soundInfo.chans[i];
    if (!(chan.statusFlags & SOUND_CHANNEL_SF_ON)) continue; // _081DCF60
    if (!ChannelEnvelope(soundInfo, chan)) continue;
    const data = (chan.wav as WaveData).data;
    mixData = mixing && data ? data : null; // no PCM loaded (samples.bin comes in the background): bookkeeping only
    mixVolR = chan.envelopeVolumeRight;
    mixVolL = chan.envelopeVolumeLeft;
    ChannelSamples(chan, samples, divFreq);
  }
  mixData = null;
}

/**
 * SoundMainRAM_Reverb (m4a_1.s): each sample of this frame's slot (what was mixed there 7 frames ago) becomes
 * (its FIFO A + FIFO B samples + the next slot's, mixed 6 frames ago) × reverb / 512, rounded up by one when bit 7
 * is set, in both FIFOs: a mono echo the channels are then mixed on top of. The slot after the last one is slot 0
 * (pcmDmaCounter 2).
 */
function SoundMainRAM_Reverb(soundInfo: SoundInfo, slot: number): void {
  const buf = soundInfo.pcmBuffer;
  const reverb = soundInfo.reverb;
  const next = soundInfo.pcmDmaCounter === 2 ? 0 : slot + soundInfo.pcmSamplesPerVBlank;
  for (let i = 0; i < soundInfo.pcmSamplesPerVBlank; i++) {
    const a = slot + i;
    const b = next + i;
    let v = (buf[a + PCM_DMA_BUF_SIZE] + buf[a] + buf[b + PCM_DMA_BUF_SIZE] + buf[b]) * reverb;
    v >>= 9;
    if (v & 0x80) v += 1;
    buf[a + PCM_DMA_BUF_SIZE] = v; // strb: the low byte
    buf[a] = v;
  }
}

/** SoundMainRAM_NoReverb (m4a_1.s): clears this frame's slot in both FIFOs. */
function SoundMainRAM_NoReverb(buf: Int8Array, slot: number, samples: number): void {
  buf.fill(0, slot, slot + samples);
  buf.fill(0, slot + PCM_DMA_BUF_SIZE, slot + PCM_DMA_BUF_SIZE + samples);
}

/** Adds one output sample to both FIFOs (the asm's `mul r12, r10, lr; bic r12, 0xFF0000; add r6, r12, r6 ror 8`:
 *  the volume is pre-shifted by 16, so each byte lane gets (volume × sample) >> 8, wrapping at 8 bits). */
function mixSample(i: number, s: number): void {
  const a = mixSlot + i;
  mixBuf[a] += Math.imul(mixVolR, s) >> 8;
  mixBuf[a + PCM_DMA_BUF_SIZE] += Math.imul(mixVolL, s) >> 8;
}

/**
 * The envelope (m4a_1.s _081DCF6A to _081DD006). Returns false if the channel stopped (statusFlags = 0).
 *
 * START: the sample starts (currentPointer = the start offset, count = the samples from there to the end, the
 * loop flag from the WaveData) in ATTACK, unless the note was already released (STOP), which ends it. ATTACK adds
 * `attack` until 255 (then DECAY); DECAY multiplies by decay / 256 down to `sustain` (then SUSTAIN; a sustain of
 * 0 goes straight to the echo); SUSTAIN holds; a released note (STOP) multiplies by release / 256 each frame down
 * to pseudoEchoVolume, then holds that for pseudoEchoLength frames (IEC) if it isn't 0. Last, the master volume
 * and the channel's left / right volumes give envelopeVolumeLeft / Right.
 */
function ChannelEnvelope(soundInfo: SoundInfo, chan: SoundChannel): boolean {
  let flags = chan.statusFlags;
  let env: number;

  const stop = (): false => {
    chan.statusFlags = 0; // _081DCFB0
    return false;
  };
  /** _081DCFC8: the release (or a sustain of 0) reached the echo volume. */
  const echoOrStop = (): boolean => {
    env = chan.pseudoEchoVolume;
    if (env === 0) return false;
    flags |= SOUND_CHANNEL_SF_IEC;
    chan.statusFlags = flags;
    return true;
  };
  /** _081DCFF8 */
  const attack = (): void => {
    env += chan.attack;
    if (env >= 0xff) {
      env = 0xff;
      flags -= 1; // ATTACK → DECAY
      chan.statusFlags = flags;
    }
  };

  if (flags & SOUND_CHANNEL_SF_START) {
    if (flags & SOUND_CHANNEL_SF_STOP) return stop();
    const wav = chan.wav;
    if (!isWaveData(wav)) return stop(); // no sample (the voice data isn't loaded): nothing to play
    flags = SOUND_CHANNEL_SF_ENV_ATTACK;
    chan.statusFlags = flags;
    chan.currentPointer = chan.count; // wav->data + count (the start offset, the track's unk_3C)
    chan.count = (wav.size - chan.count) | 0;
    env = 0;
    chan.fw = 0;
    if ((wav.status >>> 8) & WAVE_DATA_FLAG_LOOP) {
      flags |= SOUND_CHANNEL_SF_LOOP;
      chan.statusFlags = flags;
    }
    attack();
  } else {
    env = chan.envelopeVolume;
    if (flags & SOUND_CHANNEL_SF_IEC) {
      const left = chan.pseudoEchoLength;
      chan.pseudoEchoLength = u8(left - 1);
      if (left <= 1) return stop(); // bhi: on while the count was above 1
    } else if (flags & SOUND_CHANNEL_SF_STOP) {
      env = (env * chan.release) >> 8;
      if (env <= chan.pseudoEchoVolume && !echoOrStop()) return stop();
    } else {
      const state = flags & SOUND_CHANNEL_SF_ENV;
      if (state === SOUND_CHANNEL_SF_ENV_DECAY) {
        env = (env * chan.decay) >> 8;
        if (env <= chan.sustain) {
          env = chan.sustain;
          if (env === 0) {
            if (!echoOrStop()) return stop();
          } else {
            flags -= 1; // DECAY → SUSTAIN
            chan.statusFlags = flags;
          }
        }
      } else if (state === SOUND_CHANNEL_SF_ENV_ATTACK) {
        attack();
      }
    }
  }

  // _081DD006
  chan.envelopeVolume = env;
  const vol = ((soundInfo.masterVolume + 1) * env) >> 4;
  chan.envelopeVolumeRight = (chan.rightVolume * vol) >> 8;
  chan.envelopeVolumeLeft = (chan.leftVolume * vol) >> 8;
  return true;
}

/**
 * The sample position over one frame (m4a_1.s _081DD03A on, and SoundMainRAM_Unk1 for the compressed and reverse
 * voices). Every path moves the same way: per output sample, `fw += step` and the integer part (fw >> 23) is the
 * number of samples to move on, taken off `count`; when count reaches 0 or below, a looping sample goes back to
 * its loop start (by the overshoot) and any other one stops the channel (statusFlags = 0) in the middle of the
 * frame. The step is `divFreq * frequency`, or 2^23 (one sample) for a FIX voice.
 */
function ChannelSamples(chan: SoundChannel, samples: number, divFreq: number): void {
  const wav = chan.wav as WaveData; // ChannelEnvelope checked it on START; a channel only starts there
  // [sp, 0x10] / [sp, 0xC]: the loop's length (0: none) and start.
  const loopLen = chan.statusFlags & SOUND_CHANNEL_SF_LOOP ? (wav.size - wav.loopStart) | 0 : 0;
  const type = chan.type;

  if (type & (TONEDATA_TYPE_CMP | TONEDATA_TYPE_REV)) {
    // SoundMainRAM_Unk1
    if (!(chan.statusFlags & SOUND_CHANNEL_SF_SPECIAL)) {
      chan.statusFlags |= SOUND_CHANNEL_SF_SPECIAL;
      // _081DD29C: a reverse voice starts from the end, minus the start offset (its pointer is one past the
      // sample it plays next, as it reads backwards).
      if (type & TONEDATA_TYPE_REV) chan.currentPointer = wav.size - chan.currentPointer;
    }
    const step = type & TONEDATA_TYPE_FIX ? FW_ONE : Math.imul(divFreq, chan.frequency) >>> 0;
    if (wav.type !== 0) {
      // A compressed sample (the cries): SoundMainRAM_Unk2 decodes 64-sample blocks into a buffer cached by
      // `xpi`; here they are PCM already, so there is no cache to keep.
      if (type & TONEDATA_TYPE_REV) Reverse(chan, samples, step);
      else Forward(chan, samples, step, loopLen, wav.loopStart);
    } else if (type & TONEDATA_TYPE_REV) {
      Reverse(chan, samples, step); // _081DD468
    }
    // A compressed voice on an uncompressed sample plays nothing and never ends (_081DD468 → _081DD4F0); FRLG's
    // compressed voices are all cries, whose samples are compressed.
    return;
  }

  if (type & TONEDATA_TYPE_FIX) Forward(chan, samples, FW_ONE, loopLen, wav.loopStart); // _081DD07C
  else Forward(chan, samples, Math.imul(divFreq, chan.frequency) >>> 0, loopLen, wav.loopStart); // _081DD19C
}

/** The largest step for which a frame's steps add up in one go: while `fw < 2^23` and `fw + step < 2^30`, the asm's
 *  `bic 0x3F800000` is `fw mod 2^23`, so n output samples move floor((fw + n × step) / 2^23) samples. */
const FAST_STEP_MAX = 0x40000000 - FW_ONE;

/**
 * The frame's steps in one go when the sample doesn't reach its end in this frame, for when nothing is mixed (the
 * loops below give the same position, count and fw sample by sample). Returns false (nothing changed) when the
 * per-sample loop must run.
 */
function FastForward(chan: SoundChannel, samples: number, step: number, dir: 1 | -1): boolean {
  if (step >= FAST_STEP_MAX || chan.fw >= FW_ONE) return false;
  const total = chan.fw + samples * step; // < 2^53: exact
  const moved = Math.floor(total / FW_ONE);
  const count = chan.count | 0;
  if (moved >= count) return false;
  chan.fw = total - moved * FW_ONE;
  chan.count = count - moved;
  chan.currentPointer += dir * moved;
  return true;
}

/** A forward sample (_081DD07C / _081DD19C, and Unk1's compressed path _081DD308). */
function Forward(chan: SoundChannel, samples: number, step: number, loopLen: number, loopStart: number): void {
  const data = mixData;
  if (!data && FastForward(chan, samples, step, 1)) return;
  let fw = chan.fw;
  let count = chan.count | 0;
  let cur = chan.currentPointer;
  for (let i = 0; i < samples; i++) {
    if (data) {
      // _081DD1BC: data[cur] + (fw × (data[cur + 1] - data[cur])) >> 23. A FIX voice (_081DD0B0) reads data[cur]
      // alone; its fw stays 0, so this is the same. data has size + 1 bytes (the one past the end is the WAV's).
      const s0 = data[cur] | 0;
      mixSample(i, s0 + (Math.imul(fw, (data[cur + 1] | 0) - s0) >> 23));
    }
    fw = (fw + step) >>> 0;
    let lr = fw >>> 23;
    if (lr === 0) continue;
    fw = (fw & ~0x3f800000) >>> 0;
    count = (count - lr) | 0;
    if (count > 0) {
      cur += lr;
      continue;
    }
    // _081DD134 / _081DD398: the end of the sample
    if (loopLen === 0) {
      chan.statusFlags = 0; // _081DD158 / _081DD4F4: the channel ends here
      return;
    }
    lr = -count;
    for (;;) {
      count = (count + loopLen) | 0;
      if (count > 0) break;
      lr -= loopLen;
    }
    cur = loopStart + lr;
  }
  chan.fw = fw;
  chan.count = count;
  chan.currentPointer = cur;
}

/** A reverse sample (Unk1's _081DD3C0 and _081DD468): reads backwards from currentPointer - 1; no loop. */
function Reverse(chan: SoundChannel, samples: number, step: number): void {
  const data = mixData;
  if (!data && FastForward(chan, samples, step, -1)) return;
  let fw = chan.fw;
  let count = chan.count | 0;
  let cur = chan.currentPointer;
  for (let i = 0; i < samples; i++) {
    if (data) {
      // _081DD488 / _081DD3E0: data[cur - 1] toward data[cur - 2] (before the start, the ROM reads the WaveData
      // header's last bytes: 0 here).
      const s0 = data[cur - 1] | 0;
      mixSample(i, s0 + (Math.imul(fw, (data[cur - 2] | 0) - s0) >> 23));
    }
    fw = (fw + step) >>> 0;
    const lr = fw >>> 23;
    if (lr === 0) continue;
    fw = (fw & ~0x3f800000) >>> 0;
    count = (count - lr) | 0;
    if (count <= 0) {
      chan.statusFlags = 0; // _081DD4F4
      return;
    }
    cur -= lr;
  }
  chan.fw = fw;
  chan.count = count;
  chan.currentPointer = cur;
}
