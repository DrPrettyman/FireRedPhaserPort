// The GBA's PSG sound registers (REG_SOUND1CNT_L 0x4000060 to REG_SOUNDBIAS_H 0x4000089, and the wave RAM at
// 0x4000090), as the m4a engine writes and reads them: SoundInit, MPlayExtender, m4aSoundMode, CgbSound, CgbOscOff,
// ply_port and SetPokemonCryStereo (m4a.c, m4a_1.s). Pure: no DOM; the output's PSG synth (psgSynth.ts) imports the
// offsets and the PsgFrame shape from here.
//
// The engine keeps the register file (what a read returns: every register the engine reads back, NRx2, NR10, NR43,
// NR51 and SOUNDBIAS_H, reads as written on the GBA) and a log of the writes in order. Each frame
// (audio/frame.ts's AgbMainFrameEnd, through m4aPcmFrame) takes the log as a PsgFrame: the state before the
// frame's writes, then the writes. A synth replays the writes as the hardware takes them (a write of NRx4 with bit
// 7 set restarts the channel: its length counter, envelope and frequency timer), and can load `state` whenever it
// starts or has dropped frames.

/** Offsets from REG_SOUND1CNT_L (0x4000060), as io_reg.h's REG_OFFSET_* minus 0x60. */
export const PSG_NR10 = 0x00;
export const PSG_NR11 = 0x02;
export const PSG_NR12 = 0x03;
export const PSG_NR13 = 0x04;
export const PSG_NR14 = 0x05;
export const PSG_NR21 = 0x08;
export const PSG_NR22 = 0x09;
export const PSG_NR23 = 0x0c;
export const PSG_NR24 = 0x0d;
export const PSG_NR30 = 0x10;
export const PSG_NR31 = 0x12;
export const PSG_NR32 = 0x13;
export const PSG_NR33 = 0x14;
export const PSG_NR34 = 0x15;
export const PSG_NR41 = 0x18;
export const PSG_NR42 = 0x19;
export const PSG_NR43 = 0x1c;
export const PSG_NR44 = 0x1d;
/** SOUNDCNT_L's low byte: the PSG master volumes (bits 0-2 right, 4-6 left). */
export const PSG_NR50 = 0x20;
/** SOUNDCNT_L's high byte: each PSG channel's routing (bits 0-3 right, 4-7 left; channel n is bit n - 1). */
export const PSG_NR51 = 0x21;
/** REG_SOUNDCNT_H, low and high byte (bits 0-1: the PSG's share, 0 25%, 1 50%, 2 100%). */
export const PSG_SOUNDCNT_H_L = 0x22;
export const PSG_SOUNDCNT_H_H = 0x23;
/** SOUNDCNT_X / NR52: bit 7 the master enable. */
export const PSG_NR52 = 0x24;
export const PSG_SOUNDBIAS_L = 0x28;
export const PSG_SOUNDBIAS_H = 0x29;
/** WAVE_RAM0-3: the 16 bytes of the wave RAM bank NR30 bit 6 doesn't play. */
export const PSG_WAVE_RAM = 0x30;
export const PSG_WAVE_RAM_END = 0x40;

/** PsgFrame.state's layout: registers 0x00-0x2F as above, then wave RAM bank 0 (0x30-0x3F), then bank 1. */
export const PSG_STATE_BANK0 = 0x30;
export const PSG_STATE_BANK1 = 0x40;
export const PSG_STATE_SIZE = 0x50;

/**
 * The PSG part of a frame of sound (output.ts's SoundFrame.psg): what the engine did to the sound registers since
 * the previous frame, the game logic's writes (CgbOscOff from TrackStop, when a song is stopped or replaced) then
 * CgbSound's in VBlank.
 */
export interface PsgFrame {
  /** The writes in order, each `offset << 8 | value` (offsets above; 0x30-0x3F go to the bank NR30 bit 6 doesn't
   *  play at the time of the write). */
  writes: Uint16Array;
  /** The register file and both wave RAM banks before `writes` (PSG_STATE_SIZE bytes): latched values, no
   *  events. A synth that (re)starts loads it, then applies `writes`. */
  state: Uint8Array;
}

/** The registers 0x00-0x2F, then wave RAM bank 0 and bank 1: PsgFrame.state's layout. */
const regs = new Uint8Array(PSG_STATE_SIZE);
/** regs as they were when the log was last taken. */
const frameStart = new Uint8Array(PSG_STATE_SIZE);
let log: number[] = [];

/** The hardware at power-on (the BIOS leaves SOUNDBIAS at 0x200, everything else 0), with no writes logged. The
 *  port's m4aSoundInit calls it first, so a soft reset starts from the same registers as a boot. */
export function resetSoundRegs(): void {
  regs.fill(0);
  regs[PSG_SOUNDBIAS_H] = 0x02;
  frameStart.set(regs);
  log = [];
}
resetSoundRegs();

/** A byte write to REG_SOUND1CNT_L + offset. Offsets past the wave RAM (the FIFOs, DMA, ...) aren't PSG: ignored. */
export function SoundRegWrite8(offset: number, value: number): void {
  offset &= 0xff;
  value &= 0xff;
  if (offset >= PSG_WAVE_RAM_END) return;
  if (offset >= PSG_WAVE_RAM) {
    // The CPU reaches the bank that isn't playing (GBATEK "SOUND3CNT_L").
    const bank = regs[PSG_NR30] & 0x40 ? PSG_STATE_BANK0 : PSG_STATE_BANK1;
    regs[bank + offset - PSG_WAVE_RAM] = value;
  } else {
    regs[offset] = value;
  }
  log.push((offset << 8) | value);
}

/** A halfword write (low byte first, as the bus stores it). */
export function SoundRegWrite16(offset: number, value: number): void {
  SoundRegWrite8(offset, value);
  SoundRegWrite8(offset + 1, value >> 8);
}

/** A word write (REG_WAVE_RAM0-3: four bytes in memory order). */
export function SoundRegWrite32(offset: number, value: number): void {
  SoundRegWrite16(offset, value);
  SoundRegWrite16(offset + 2, value >>> 16);
}

/** A byte read: the last value written (the registers the engine reads back are readable as written). */
export function SoundRegRead8(offset: number): number {
  offset &= 0xff;
  if (offset >= PSG_WAVE_RAM_END) return 0;
  if (offset >= PSG_WAVE_RAM) {
    const bank = regs[PSG_NR30] & 0x40 ? PSG_STATE_BANK0 : PSG_STATE_BANK1;
    return regs[bank + offset - PSG_WAVE_RAM];
  }
  return regs[offset];
}

/** The frame's PsgFrame: the state when the last one was taken, and the writes since. Taken once per frame
 *  (m4aPcmFrame), whether or not the frame is heard, so the log never grows past a frame's writes. */
export function takePsgFrame(): PsgFrame {
  const frame: PsgFrame = { writes: Uint16Array.from(log), state: frameStart.slice() };
  log = [];
  frameStart.set(regs);
  return frame;
}

/** The register file now (PsgFrame.state's layout), for tests and dev hooks. */
export function soundRegsSnapshot(): Uint8Array {
  return regs.slice();
}
