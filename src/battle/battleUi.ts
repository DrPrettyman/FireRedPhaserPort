// What battle code needs from outside the emulated GBA video layer: input, audio and save data. BattleScene implements it.

export type GbaButton = 'A' | 'B' | 'START' | 'SELECT' | 'L' | 'R' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface BattleUi {
  /** JOY_NEW */
  joyNew(button: GbaButton): boolean;
  /** JOY_HELD */
  joyHeld(button: GbaButton): boolean;
  /** gMain.newKeys != 0 */
  anyNewKeys(): boolean;
  /** PlaySE (audio isn't implemented; kept so call sites read like the C) */
  playSE(songId: number): void;
  /** PlayCry_* (no audio yet) */
  playCry(species: number): void;
  /** PlayBGM / PlayFanfare (no audio yet) */
  playBGM(songId: number): void;
  playFanfare(songId: number): void;
  /** AddBagItem */
  addBagItem(itemId: number, count: number): void;
  /** gSaveBlock2Ptr->playerGender (MALE 0 / FEMALE 1, which is also the TRAINER_BACK_PIC id) */
  playerGender(): number;
}

export let ui: BattleUi;

export function setBattleUi(u: BattleUi): void {
  ui = u;
}
