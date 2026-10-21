import Phaser from 'phaser';
import { sampleVirtualPad } from '../dev/testHooks';

export type Button = 'A' | 'B' | 'START' | 'SELECT' | 'L' | 'R' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

const K = Phaser.Input.Keyboard.KeyCodes;

/** Keyboard layout, emulator-style. Arrows only for the D-pad so letter keys are free for buttons. */
export const KEY_BINDINGS: Record<Button, number[]> = {
  A: [K.Z, K.SPACE],
  B: [K.X],
  START: [K.ENTER],
  SELECT: [K.BACKSPACE],
  L: [K.A],
  R: [K.S],
  UP: [K.UP],
  DOWN: [K.DOWN],
  LEFT: [K.LEFT],
  RIGHT: [K.RIGHT],
};

const BUTTONS = Object.keys(KEY_BINDINGS) as Button[];

/**
 * GBA-style button state sampled once per logic tick: `held` mirrors gMain.heldKeys and
 * `pressed` mirrors gMain.newKeys (true only on the tick the button went down). Sampling per
 * tick rather than per render frame keeps input deterministic with the fixed 60Hz loop.
 */
export class Input {
  private keys: Record<Button, Phaser.Input.Keyboard.Key[]>;
  private heldNow = new Set<Button>();
  private heldPrev = new Set<Button>();
  /**
   * gSaveBlock2Ptr->optionsButtonMode == OPTIONS_BUTTON_MODE_L_EQUALS_A, for an Input whose readers don't go through
   * ReadKeys (the field's): `held` / `pressed` then report A for L as ReadKeys does (newKeys |= A_BUTTON when L is
   * new, heldKeys |= A_BUTTON when L is held). `heldRaw` stays the keys themselves (ReadKeys' keyInput).
   */
  lEqualsA = false;

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;
    this.keys = Object.fromEntries(
      BUTTONS.map((b) => [b, KEY_BINDINGS[b].map((code) => kb.addKey(code, true))]),
    ) as Record<Button, Phaser.Input.Keyboard.Key[]>;
  }

  /** Call once at the start of every logic tick. */
  sample(): void {
    this.heldPrev = this.heldNow;
    this.heldNow = new Set(BUTTONS.filter((b) => this.keys[b].some((k) => k.isDown)));
    for (const b of sampleVirtualPad()) this.heldNow.add(b); // dev: the e2e tests' buttons
  }

  /** For this tick, `b` is the only button held, and newly pressed (QuestLogOverrideJoyVars). */
  override(b: Button): void {
    this.heldNow = new Set([b]);
    this.heldPrev = new Set();
  }

  /** The button itself, without the L=A remap (ReadKeys' REG_KEYINPUT read). */
  heldRaw(b: Button): boolean {
    return this.heldNow.has(b);
  }

  held(b: Button): boolean {
    return this.heldNow.has(b) || (b === 'A' && this.lEqualsA && this.heldNow.has('L'));
  }

  pressed(b: Button): boolean {
    return this.pressedRaw(b) || (b === 'A' && this.lEqualsA && this.pressedRaw('L'));
  }

  private pressedRaw(b: Button): boolean {
    return this.heldNow.has(b) && !this.heldPrev.has(b);
  }

  /** A or B newly pressed: the usual "advance text" check (JOY_NEW(A_BUTTON | B_BUTTON)). */
  pressedAorB(): boolean {
    return this.pressed('A') || this.pressed('B');
  }
}

// ------------------------------------------------------------------ the audio output's keys (AUDIO_PLAN.md W-out 1)

/** The mute key (AUDIO_PLAN.md decision 10; docs/DEVIATIONS.md "Deliberate QOL changes"): no game or dev binding. */
export const MUTE_KEY_CODE = 'KeyM';

/** A key typed into a text field (the battle test panel's) is the field's, not the game's. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/**
 * The page-level keys the audio output (audio/output.ts) needs, outside the per-tick button state: the first
 * keydown or pointerdown anywhere is the user gesture the browser wants before audio may start (autoplay), and
 * M toggles the output on and off. Listens on window in the capture phase, so a gesture counts even where the
 * battle test panel stops its keys from reaching the game; M itself is ignored in text fields and with Ctrl /
 * Cmd / Alt (Cmd+M minimizes on macOS). Nothing here reaches the game's logic.
 */
export function listenForOutputKeys(handlers: { gesture: () => void; toggleMute: () => void }): void {
  const onKey = (e: KeyboardEvent): void => {
    handlers.gesture();
    if (e.code !== MUTE_KEY_CODE || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
    handlers.toggleMute();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', () => handlers.gesture(), true);
}
