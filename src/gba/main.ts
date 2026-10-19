// main.c: gMain (the main callbacks and the key state) and ReadKeys. Screens built on the emulated
// GBA layer (battle, party menu, bag) hand control to each other through gMain.callback2 exactly
// like the C, so `gMain.callback2 === BattleMainCB2` style checks work.

import type { Button, Input } from '../input/Input';

export type MainCallback = () => void;

// include/gba/io_reg.h key bits
export const A_BUTTON = 0x0001;
export const B_BUTTON = 0x0002;
export const SELECT_BUTTON = 0x0004;
export const START_BUTTON = 0x0008;
export const DPAD_RIGHT = 0x0010;
export const DPAD_LEFT = 0x0020;
export const DPAD_UP = 0x0040;
export const DPAD_DOWN = 0x0080;
export const R_BUTTON = 0x0100;
export const L_BUTTON = 0x0200;
export const DPAD_ANY = DPAD_RIGHT | DPAD_LEFT | DPAD_UP | DPAD_DOWN;

const BUTTON_BITS: [Button, number][] = [
  ['A', A_BUTTON],
  ['B', B_BUTTON],
  ['SELECT', SELECT_BUTTON],
  ['START', START_BUTTON],
  ['RIGHT', DPAD_RIGHT],
  ['LEFT', DPAD_LEFT],
  ['UP', DPAD_UP],
  ['DOWN', DPAD_DOWN],
  ['R', R_BUTTON],
  ['L', L_BUTTON],
];

/** struct Main */
export const gMain = {
  callback1: null as MainCallback | null,
  callback2: null as MainCallback | null,
  savedCallback: null as MainCallback | null,
  vblankCallback: null as MainCallback | null,
  hblankCallback: null as MainCallback | null,
  heldKeysRaw: 0,
  newKeysRaw: 0,
  heldKeys: 0,
  newKeys: 0,
  newAndRepeatedKeys: 0,
  keyRepeatCounter: 0,
  state: 0,
  inBattle: false,
  /**
   * The u32 VBlankIntr increments each frame (SetVBlankCounter1Ptr); FRLG's only user is the Trainer Tower's
   * challenge timer (gSaveBlock1Ptr->trainerTower[].timer, world/trainerTower.ts), so it points at that record.
   */
  vblankCounter1: null as { timer: number } | null,
};

/** SetVBlankCounter1Ptr */
export function SetVBlankCounter1Ptr(counter: { timer: number }): void {
  gMain.vblankCounter1 = counter;
}

/** DisableVBlankCounter1 (also SoftReset's InitMainCallbacks) */
export function DisableVBlankCounter1(): void {
  gMain.vblankCounter1 = null;
}

/** VBlankIntr's `if (gMain.vblankCounter1) (*gMain.vblankCounter1)++;`: once per frame on every screen. */
export function VBlankCounter1Update(): void {
  if (gMain.vblankCounter1) gMain.vblankCounter1.timer = (gMain.vblankCounter1.timer + 1) >>> 0;
}

// InitKeys
const gKeyRepeatContinueDelay = 5;
let gKeyRepeatStartDelay = 40;

/** gKeyRepeatStartDelay (the naming screen shortens it while it runs). */
export function GetKeyRepeatStartDelay(): number {
  return gKeyRepeatStartDelay;
}
export function SetKeyRepeatStartDelay(delay: number): void {
  gKeyRepeatStartDelay = delay;
}

export function SetMainCallback1(callback: MainCallback | null): void {
  gMain.callback1 = callback;
}

export function SetMainCallback2(callback: MainCallback | null): void {
  gMain.callback2 = callback;
  gMain.state = 0;
}

export function SetVBlankCallback(callback: MainCallback | null): void {
  gMain.vblankCallback = callback;
}

/** HBlank callbacks aren't emulated (scanline effects use hblankRegs); kept for call-site parity. */
export function SetHBlankCallback(callback: MainCallback | null): void {
  gMain.hblankCallback = callback;
}

/** CallCallbacks */
export function CallCallbacks(): void {
  gMain.callback1?.();
  gMain.callback2?.();
}

/** gMain's key fields: what ReadKeys writes and JOY_NEW / JOY_HELD / JOY_REPT read. */
export type KeyState = Pick<typeof gMain, 'heldKeysRaw' | 'newKeysRaw' | 'heldKeys' | 'newKeys' | 'newAndRepeatedKeys' | 'keyRepeatCounter'>;

/** A key state of its own, for the field (whose logic reads its Input, not gMain): the help system's keys there. */
export function NewKeyState(): KeyState {
  return { heldKeysRaw: 0, newKeysRaw: 0, heldKeys: 0, newKeys: 0, newAndRepeatedKeys: 0, keyRepeatCounter: 0 };
}

/**
 * ReadKeys: sample the buttons into gMain's raw/held/new/repeated masks (or `gMain`'s stand-in `keys`). `lEqualsA`
 * is gSaveBlock2Ptr->optionsButtonMode == OPTIONS_BUTTON_MODE_L_EQUALS_A.
 */
export function ReadKeys(input: Input, lEqualsA = false, keys: KeyState = gMain): void {
  const gMain = keys;
  let keyInput = 0;
  for (const [b, bit] of BUTTON_BITS) if (input.held(b)) keyInput |= bit;
  gMain.newKeysRaw = keyInput & ~gMain.heldKeysRaw;
  gMain.newKeys = gMain.newKeysRaw;
  gMain.newAndRepeatedKeys = gMain.newKeysRaw;

  // BUG: Key repeat won't work when pressing L using L=A button mode
  // because it compares the raw key input with the remapped held keys.
  if (keyInput !== 0 && gMain.heldKeys === keyInput) {
    gMain.keyRepeatCounter--;
    if (gMain.keyRepeatCounter === 0) {
      gMain.newAndRepeatedKeys = keyInput;
      gMain.keyRepeatCounter = gKeyRepeatContinueDelay;
    }
  } else {
    // If there is no input or the input has changed, reset the counter.
    gMain.keyRepeatCounter = gKeyRepeatStartDelay;
  }
  gMain.heldKeysRaw = keyInput;
  gMain.heldKeys = gMain.heldKeysRaw;

  if (lEqualsA) {
    if (gMain.newKeys & L_BUTTON) gMain.newKeys |= A_BUTTON; // JOY_NEW / JOY_HELD on `keys`
    if (gMain.heldKeys & L_BUTTON) gMain.heldKeys |= A_BUTTON;
  }
}

export const JOY_NEW = (button: number): number => gMain.newKeys & button;
export const JOY_HELD = (button: number): number => gMain.heldKeys & button;
export const JOY_REPT = (button: number): number => gMain.newAndRepeatedKeys & button;
