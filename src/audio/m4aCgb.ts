// The four PSG channels (gCgbChans: square 1, square 2, wave, noise): m4a.c's CgbSound, CgbModVol, CgbPan,
// CgbOscOff and MidiKeyToCgbFreq. A note on a CGB voice claims its channel (ply_note, m4a.ts); CgbSound, run once
// per frame between the sequencers and SoundMainRAM (SoundMain), starts it, runs its software envelope (attack,
// decay, sustain, release, then the pseudo echo) and writes the sound registers (soundRegs.ts), where the hardware
// does the rest: the duty / wave / noise, the frequency timer, the length counter and the hardware envelope that
// CgbSound restarts whenever it changes the volume. The registers reach the output as each frame's PsgFrame
// (soundRegs.ts, m4aPcmFrame).

import {
  CGB_CHANNEL_MO_PIT,
  CGB_CHANNEL_MO_VOL,
  SOUND_CHANNEL_SF_ENV,
  SOUND_CHANNEL_SF_ENV_ATTACK,
  SOUND_CHANNEL_SF_ENV_DECAY,
  SOUND_CHANNEL_SF_ENV_RELEASE,
  SOUND_CHANNEL_SF_ENV_SUSTAIN,
  SOUND_CHANNEL_SF_IEC,
  SOUND_CHANNEL_SF_ON,
  SOUND_CHANNEL_SF_START,
  SOUND_CHANNEL_SF_STOP,
  TONEDATA_TYPE_FIX,
  s8,
  u8,
  type CgbChannel,
  type SoundInfo,
} from './m4aInternal';
import { gCgb3Vol, gCgbFreqTable, gCgbScaleTable, gClockTable, gNoiseTable } from './m4aTables';
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
  PSG_NR51,
  PSG_SOUNDBIAS_H,
  PSG_WAVE_RAM,
  SoundRegRead8,
  SoundRegWrite8,
} from './soundRegs';

/** m4a_internal.h */
export const CGB_NRx2_ENV_DIR_DEC = 0x00;
export const CGB_NRx2_ENV_DIR_INC = 0x08;

function newCgbChannel(): CgbChannel {
  return {
    statusFlags: 0, type: 0, rightVolume: 0, leftVolume: 0, attack: 0, decay: 0, sustain: 0, release: 0, key: 0,
    envelopeVolume: 0, envelopeVolumeRight: 0, envelopeVolumeLeft: 0, pseudoEchoVolume: 0, pseudoEchoLength: 0,
    gateTime: 0, midiKey: 0, velocity: 0, priority: 0, rhythmPan: 0, count: 0, fw: 0, frequency: 0, wav: null,
    currentPointer: 0, track: null, prevChannelPointer: null, nextChannelPointer: null, envelopeGoal: 0,
    envelopeCounter: 0, sustainGoal: 0, n4: 0, pan: 0, panMask: 0, modify: 0, length: 0, sweep: 0,
    cgbCurrentPointer: null,
  };
}

/** gCgbChans as MPlayExtender (m4a.c:257) sets them up: cleared, types 1-4, the pan masks. */
export function newCgbChannels(): CgbChannel[] {
  const chans = Array.from({ length: 4 }, newCgbChannel);
  chans.forEach((chan, i) => {
    chan.type = i + 1;
    chan.panMask = 0x11 << i;
  });
  return chans;
}

/** MidiKeyToCgbFreq (m4a.c:810): the register frequency for a key and fine adjustment (1/256 semitone). Noise
 *  (chanNum 4): NR43's clock from gNoiseTable, keys 21-80. Squares and wave: 2048 − 131072 / Hz (11 bits), keys
 *  36-166, interpolated linearly toward the next semitone, + 2048 (bit 11, which lands in NRx4's unused bit 3). */
export function MidiKeyToCgbFreq(chanNum: number, key: number, fineAdjust: number): number {
  key = u8(key);
  fineAdjust = u8(fineAdjust);
  if (chanNum === 4) {
    if (key <= 20) {
      key = 0;
    } else {
      key = u8(key - 21);
      if (key > 59) key = 59;
    }
    return gNoiseTable[key];
  }

  if (key <= 35) {
    fineAdjust = 0;
    key = 0;
  } else {
    key = u8(key - 36);
    if (key > 130) {
      key = 130;
      fineAdjust = 255;
    }
  }
  let val1 = gCgbScaleTable[key];
  val1 = gCgbFreqTable[val1 & 0xf] >> (val1 >> 4);
  let val2 = gCgbScaleTable[key + 1];
  val2 = gCgbFreqTable[val2 & 0xf] >> (val2 >> 4);
  return val1 + ((fineAdjust * (val2 - val1)) >> 8) + 2048;
}

/** CgbOscOff (m4a.c:857): silences channel chanNum: the envelope to 0 (decreasing) and a restart for the squares and
 *  noise, the DAC off for the wave. */
export function CgbOscOff(chanNum: number): void {
  switch (chanNum) {
    case 1:
      SoundRegWrite8(PSG_NR12, 8);
      SoundRegWrite8(PSG_NR14, 0x80);
      break;
    case 2:
      SoundRegWrite8(PSG_NR22, 8);
      SoundRegWrite8(PSG_NR24, 0x80);
      break;
    case 3:
      SoundRegWrite8(PSG_NR30, 0);
      break;
    default:
      SoundRegWrite8(PSG_NR42, 8);
      SoundRegWrite8(PSG_NR44, 0x80);
  }
}

/** CgbPan (m4a.c:887): a channel at least twice as loud on one side goes to that side only (pan 0x0F right, 0xF0
 *  left); returns whether it did. */
function CgbPan(chan: CgbChannel): boolean {
  const rightVolume = u8(chan.rightVolume);
  const leftVolume = u8(chan.leftVolume);
  if (rightVolume >= leftVolume) {
    if (rightVolume >> 1 >= leftVolume) {
      chan.pan = 0x0f;
      return true;
    }
  } else if (leftVolume >> 1 >= rightVolume) {
    chan.pan = 0xf0;
    return true;
  }
  return false;
}

/** CgbModVol (m4a.c:907): the envelope's goal ((left + right) / 16: up to 31 when not panned to one side, at most 15
 *  when it is) and sustain level, and the pan: both speakers in mono (soundInfo.mode bit 0, SetPokemonCryStereo) or
 *  unless CgbPan sends it to one side. The PSG has no per-side volume: NR51 only routes. */
export function CgbModVol(soundInfo: SoundInfo, chan: CgbChannel): void {
  if (soundInfo.mode & 1 || !CgbPan(chan)) {
    chan.pan = 0xff;
    chan.envelopeGoal = u8((chan.leftVolume + chan.rightVolume) >>> 4);
  } else {
    chan.envelopeGoal = u8((chan.leftVolume + chan.rightVolume) >>> 4);
    if (chan.envelopeGoal > 15) chan.envelopeGoal = 15;
  }
  chan.sustainGoal = u8((chan.envelopeGoal * chan.sustain + 15) >> 4);
  chan.pan &= chan.panMask;
}

/** gCgb3Vol[i]. An envelope volume above 15 (a goal past 15, not panned to one side) reads on into gClockTable, which
 *  follows gCgb3Vol in m4a_tables.c's rodata. */
function cgb3Vol(i: number): number {
  return i < 16 ? gCgb3Vol[i] : gClockTable[i - 16];
}

// Each channel's NRx0-NRx4 (m4a.c:960). Square 2 and noise have no NRx0: their nrx0ptr is the byte after NR10 /
// NR30, which CgbSound never touches for them.
const NRX0 = [PSG_NR10, PSG_NR10 + 1, PSG_NR30, PSG_NR30 + 1];
const NRX1 = [PSG_NR11, PSG_NR21, PSG_NR31, PSG_NR41];
const NRX2 = [PSG_NR12, PSG_NR22, PSG_NR32, PSG_NR42];
const NRX3 = [PSG_NR13, PSG_NR23, PSG_NR33, PSG_NR43];
const NRX4 = [PSG_NR14, PSG_NR24, PSG_NR34, PSG_NR44];

// CgbSound's labels (the C's gotos).
const enum L {
  StepRepeat,
  StepComplete,
  DecayStart,
  SustainStart,
  Sustain,
  PseudoEchoStart,
  Complete,
  OscOff,
  ChannelComplete,
}

/**
 * CgbSound (m4a.c:925), once per frame from SoundMain after the sequencers. Per channel that is on:
 * - START (a new note): ATTACK; the volumes (CgbModVol); the registers that set the note up (square 1's sweep, the
 *   duty and length, the wave's RAM if the wave changed (with NR30's bank switch around it) and length, the
 *   noise's width); the envelope from 0, or straight to decay when attack is 0. START with STOP (released in the
 *   frame it started): off.
 * - IEC (the pseudo echo): pseudoEchoLength frames at the echo volume, then off.
 * - STOP (released): RELEASE, or the echo / off at once when release is 0.
 * - Otherwise, each time envelopeCounter reaches 0: attack (+1 every `attack` frames up to the goal), decay (−1
 *   every `decay` frames down to the sustain goal; sustain 0: the echo), sustain (the goal again every 7 frames),
 *   release (−1 every `release` frames, then the echo or off). Every 15th frame (c15) the step runs twice, to keep
 *   pace with the hardware envelope's 64 Hz, which CgbSound starts with each volume it writes (NRx2's step time and
 *   direction).
 * Then the frequency (NRx3, NRx4 without a restart) on MO_PIT, and the volume (NR51's pan bits, NRx2 and a
 * restart, or NR32 for the wave) on MO_VOL.
 */
export function CgbSound(soundInfo: SoundInfo): void {
  if (soundInfo.c15) soundInfo.c15--;
  else soundInfo.c15 = 14;

  const channels = soundInfo.cgbChans;
  if (!channels) return;
  for (let ch = 1; ch <= 4; ch++) {
    const chan = channels[ch - 1];
    if (!(chan.statusFlags & SOUND_CHANNEL_SF_ON)) continue;

    // 1. determine hardware channel registers
    const nrx0 = NRX0[ch - 1], nrx1 = NRX1[ch - 1], nrx2 = NRX2[ch - 1], nrx3 = NRX3[ch - 1], nrx4 = NRX4[ch - 1];

    let prevC15 = soundInfo.c15;
    let envelopeStepTimeAndDir = SoundRegRead8(nrx2);

    // 2. calculate envelope volume
    let next: L;
    if (chan.statusFlags & SOUND_CHANNEL_SF_START) {
      if (!(chan.statusFlags & SOUND_CHANNEL_SF_STOP)) {
        chan.statusFlags = SOUND_CHANNEL_SF_ENV_ATTACK;
        chan.modify = CGB_CHANNEL_MO_PIT | CGB_CHANNEL_MO_VOL;
        CgbModVol(soundInfo, chan);
        const wavePointer = chan.wav;
        if (ch === 3) {
          const wave = wavePointer instanceof Uint8Array ? wavePointer : null;
          if (wave !== chan.cgbCurrentPointer) {
            SoundRegWrite8(nrx0, 0x40);
            // REG_WAVE_RAM0-3 = wavePointer[0-3]: the 16 bytes in memory order.
            for (let i = 0; i < 16; i++) SoundRegWrite8(PSG_WAVE_RAM + i, wave ? wave[i] : 0);
            chan.cgbCurrentPointer = wave;
          }
          SoundRegWrite8(nrx0, 0);
          SoundRegWrite8(nrx1, chan.length);
          chan.n4 = chan.length ? 0xc0 : 0x80;
        } else {
          // The duty (squares) or the noise's width (0 15-bit, 1 7-bit).
          const n = typeof wavePointer === 'number' ? wavePointer : 0;
          if (ch === 1) SoundRegWrite8(nrx0, chan.sweep);
          if (ch <= 2) {
            SoundRegWrite8(nrx1, (n << 6) + chan.length);
          } else {
            SoundRegWrite8(nrx1, chan.length);
            SoundRegWrite8(nrx3, n << 3);
          }
          // init_env_step_time_dir
          envelopeStepTimeAndDir = chan.attack + CGB_NRx2_ENV_DIR_INC;
          chan.n4 = chan.length ? 0x40 : 0x00;
        }
        chan.envelopeCounter = chan.attack;
        if (s8(chan.attack)) {
          chan.envelopeVolume = 0;
          next = L.StepComplete;
        } else {
          // skip attack phase if attack is instantaneous (=0)
          next = L.DecayStart;
        }
      } else {
        next = L.OscOff;
      }
    } else if (chan.statusFlags & SOUND_CHANNEL_SF_IEC) {
      chan.pseudoEchoLength = u8(chan.pseudoEchoLength - 1);
      next = s8(chan.pseudoEchoLength) <= 0 ? L.OscOff : L.Complete;
    } else if (chan.statusFlags & SOUND_CHANNEL_SF_STOP && chan.statusFlags & SOUND_CHANNEL_SF_ENV) {
      chan.statusFlags &= ~SOUND_CHANNEL_SF_ENV;
      chan.envelopeCounter = chan.release;
      if (s8(chan.release)) {
        chan.modify |= CGB_CHANNEL_MO_VOL;
        if (ch !== 3) envelopeStepTimeAndDir = chan.release | CGB_NRx2_ENV_DIR_DEC;
        next = L.StepComplete;
      } else {
        next = L.PseudoEchoStart;
      }
    } else {
      next = L.StepRepeat;
    }

    for (let done = false; !done; ) {
      switch (next) {
        case L.StepRepeat: // envelope_step_repeat
          next = L.StepComplete;
          if (chan.envelopeCounter === 0) {
            if (ch === 3) chan.modify |= CGB_CHANNEL_MO_VOL;
            CgbModVol(soundInfo, chan);
            const env = chan.statusFlags & SOUND_CHANNEL_SF_ENV;
            if (env === SOUND_CHANNEL_SF_ENV_RELEASE) {
              chan.envelopeVolume = u8(chan.envelopeVolume - 1);
              if (s8(chan.envelopeVolume) <= 0) next = L.PseudoEchoStart;
              else chan.envelopeCounter = chan.release;
            } else if (env === SOUND_CHANNEL_SF_ENV_SUSTAIN) {
              next = L.Sustain;
            } else if (env === SOUND_CHANNEL_SF_ENV_DECAY) {
              chan.envelopeVolume = u8(chan.envelopeVolume - 1);
              if (s8(chan.envelopeVolume) <= s8(chan.sustainGoal)) next = L.SustainStart;
              else chan.envelopeCounter = chan.decay;
            } else {
              chan.envelopeVolume = u8(chan.envelopeVolume + 1);
              if (chan.envelopeVolume >= chan.envelopeGoal) next = L.DecayStart;
              else chan.envelopeCounter = chan.attack;
            }
          }
          break;

        case L.PseudoEchoStart: // envelope_pseudoecho_start
          chan.envelopeVolume = u8((chan.envelopeGoal * chan.pseudoEchoVolume + 0xff) >> 8);
          if (chan.envelopeVolume) {
            chan.statusFlags |= SOUND_CHANNEL_SF_IEC;
            chan.modify |= CGB_CHANNEL_MO_VOL;
            if (ch !== 3) envelopeStepTimeAndDir = 0 | CGB_NRx2_ENV_DIR_INC;
            next = L.Complete;
          } else {
            next = L.OscOff;
          }
          break;

        case L.SustainStart: // envelope_sustain_start
          if (chan.sustain === 0) {
            chan.statusFlags &= ~SOUND_CHANNEL_SF_ENV;
            next = L.PseudoEchoStart;
          } else {
            chan.statusFlags = u8(chan.statusFlags - 1);
            chan.modify |= CGB_CHANNEL_MO_VOL;
            if (ch !== 3) envelopeStepTimeAndDir = 0 | CGB_NRx2_ENV_DIR_INC;
            next = L.Sustain;
          }
          break;

        case L.Sustain: // envelope_sustain
          chan.envelopeVolume = chan.sustainGoal;
          chan.envelopeCounter = 7;
          next = L.StepComplete;
          break;

        case L.DecayStart: // envelope_decay_start
          chan.statusFlags = u8(chan.statusFlags - 1);
          chan.envelopeCounter = chan.decay;
          if (chan.envelopeCounter) {
            chan.modify |= CGB_CHANNEL_MO_VOL;
            chan.envelopeVolume = chan.envelopeGoal;
            if (ch !== 3) envelopeStepTimeAndDir = chan.decay | CGB_NRx2_ENV_DIR_DEC;
            next = L.StepComplete;
          } else {
            next = L.SustainStart;
          }
          break;

        case L.StepComplete: // envelope_step_complete
          // every 15 frames, envelope calculation has to be done twice
          // to keep up with the hardware envelope rate (1/64 s)
          chan.envelopeCounter = u8(chan.envelopeCounter - 1);
          if (prevC15 === 0) {
            prevC15--;
            next = L.StepRepeat;
          } else {
            next = L.Complete;
          }
          break;

        case L.Complete: // envelope_complete
          applyRegisters(chan, ch, nrx0, nrx2, nrx3, nrx4, envelopeStepTimeAndDir);
          next = L.ChannelComplete;
          break;

        case L.OscOff: // oscillator_off
          CgbOscOff(ch);
          chan.statusFlags = 0;
          next = L.ChannelComplete;
          break;

        case L.ChannelComplete: // channel_complete
          chan.modify = 0;
          done = true;
          break;
      }
    }
  }
}

/** CgbSound's steps 3 and 4 (m4a.c:1183): the pitch, then the envelope and volume. */
function applyRegisters(
  chan: CgbChannel,
  ch: number,
  nrx0: number,
  nrx2: number,
  nrx3: number,
  nrx4: number,
  envelopeStepTimeAndDir: number,
): void {
  // 3. apply pitch to HW registers
  if (chan.modify & CGB_CHANNEL_MO_PIT) {
    if (ch < 4 && chan.type & TONEDATA_TYPE_FIX) {
      // SoundInit and m4aSoundMode leave SOUNDBIAS_H at 0x42: the second case.
      const dacPwmRate = SoundRegRead8(PSG_SOUNDBIAS_H);
      if (dacPwmRate < 0x40) chan.frequency = (chan.frequency + 2) & 0x7fc; // PWM rate 32768 Hz
      else if (dacPwmRate < 0x80) chan.frequency = (chan.frequency + 1) & 0x7fe; // PWM rate 65536 Hz
    }
    if (ch !== 4) SoundRegWrite8(nrx3, chan.frequency);
    else SoundRegWrite8(nrx3, (SoundRegRead8(nrx3) & 0x08) | chan.frequency);
    chan.n4 = u8((chan.n4 & 0xc0) + ((chan.frequency >>> 8) & 0xff));
    SoundRegWrite8(nrx4, chan.n4);
  }

  // 4. apply envelope & volume to HW registers
  if (chan.modify & CGB_CHANNEL_MO_VOL) {
    SoundRegWrite8(PSG_NR51, (SoundRegRead8(PSG_NR51) & ~chan.panMask) | chan.pan);
    if (ch === 3) {
      SoundRegWrite8(nrx2, cgb3Vol(chan.envelopeVolume));
      if (chan.n4 & 0x80) {
        SoundRegWrite8(nrx0, 0x80);
        SoundRegWrite8(nrx4, chan.n4);
        chan.n4 &= 0x7f;
      }
    } else {
      SoundRegWrite8(nrx2, (envelopeStepTimeAndDir & 0xf) + (chan.envelopeVolume << 4));
      SoundRegWrite8(nrx4, chan.n4 | 0x80);
      if (ch === 1 && !(SoundRegRead8(nrx0) & 0x08)) SoundRegWrite8(nrx4, chan.n4 | 0x80);
    }
  }
}
