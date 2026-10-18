// The four PSG channels (gCgbChans: square 1, square 2, wave, noise), as far as the sequencer needs them: a note
// on a CGB voice claims its channel (ply_note, m4a.ts) and the channel lives from its START to its release, so the
// track linkage and the claims between tracks work.
//
// TODO(W-m4a 4): this is a placeholder. CgbSound (m4a.c:925) runs a per-frame software envelope (attack / decay /
// sustain / release in envelopeCounter steps, the pseudo echo, the hardware length counter, c15) and writes the
// sound registers; CgbOscOff (m4a.c:857) silences a channel's registers; MidiKeyToCgbFreq (m4a.c:810) gives the
// register frequency; CgbModVol / CgbPan the volumes. Here a channel goes on at START and off as soon as it is
// released (no release tail, no length counter), and the frequency is 0.

import {
  CGB_CHANNEL_MO_PIT,
  CGB_CHANNEL_MO_VOL,
  SOUND_CHANNEL_SF_ENV_ATTACK,
  SOUND_CHANNEL_SF_ON,
  SOUND_CHANNEL_SF_START,
  SOUND_CHANNEL_SF_STOP,
  type CgbChannel,
  type SoundInfo,
} from './m4aInternal';

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

/** CgbSound (m4a.c:925), placeholder (see the file's comment): the channels' lifetimes only. */
export function CgbSound(soundInfo: SoundInfo): void {
  if (soundInfo.c15) soundInfo.c15--;
  else soundInfo.c15 = 14;

  const chans = soundInfo.cgbChans;
  if (!chans) return;
  for (let ch = 1; ch <= 4; ch++) {
    const chan = chans[ch - 1];
    if (!(chan.statusFlags & SOUND_CHANNEL_SF_ON)) continue;
    if (chan.statusFlags & SOUND_CHANNEL_SF_START) {
      if (!(chan.statusFlags & SOUND_CHANNEL_SF_STOP)) {
        chan.statusFlags = SOUND_CHANNEL_SF_ENV_ATTACK;
        chan.modify = CGB_CHANNEL_MO_PIT | CGB_CHANNEL_MO_VOL;
        continue;
      }
    } else if (!(chan.statusFlags & SOUND_CHANNEL_SF_STOP)) {
      chan.modify = 0;
      continue;
    }
    // oscillator_off. TODO(W-m4a 4): a released note runs its release envelope (and pseudo echo) first.
    CgbOscOff(ch);
    chan.statusFlags = 0;
  }
}

/** CgbOscOff (m4a.c:857). TODO(W-m4a 4): silence channel chanNum's registers. */
export function CgbOscOff(_chanNum: number): void {}

/** MidiKeyToCgbFreq (m4a.c:810). TODO(W-m4a 4): the register frequency for the key (gCgbFreqTable, gNoiseTable). */
export function MidiKeyToCgbFreq(_chanNum: number, _key: number, _fineAdjust: number): number {
  return 0;
}
