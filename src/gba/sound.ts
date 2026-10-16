// sound.c / m4a: audio isn't implemented yet. These keep call sites reading like the C; fanfares
// count as already finished so code that waits on them carries on.

export function PlaySE(_songId: number): void {}

export function PlayFanfare(_songId: number): void {}

export function PlayFanfareByFanfareNum(_fanfareNum: number): void {}

/** WaitFanfare: TRUE once the fanfare has stopped. */
export function WaitFanfare(_stop: boolean): boolean {
  return true;
}

export function IsFanfareTaskInactive(): boolean {
  return true;
}

export function IsSEPlaying(): boolean {
  return false;
}

/** PlayCry_ByMode: no cries yet. */
export function PlayCry_ByMode(_species: number, _pan: number, _mode: number): void {}

/** PlayCry_Normal: no cries yet. */
export function PlayCry_Normal(_species: number, _pan: number): void {}

/** IsCryFinished: TRUE once the cry has stopped (no cries yet, so always). */
export function IsCryFinished(): boolean {
  return true;
}

export function StopCryAndClearCrySongs(): void {}

/** IsCryPlaying: FALSE (no cries yet) */
export function IsCryPlaying(): boolean {
  return false;
}

/** IsCryPlayingOrClearCrySongs: TRUE while a cry is playing. */
export function IsCryPlayingOrClearCrySongs(): boolean {
  return false;
}

/** PlayBGM: no BGM yet. */
export function PlayBGM(_songId: number): void {}

/** m4aSongNumStart: no BGM yet. */
export function m4aSongNumStart(_songId: number): void {}

/** FadeOutBGM / FadeOutMapMusic: no BGM yet. */
export function FadeOutBGM(_speed: number): void {}
export function FadeOutMapMusic(_speed: number): void {}

/** IsNotWaitingForBGMStop: TRUE once a BGM fade-out has finished (no BGM yet, so always). */
export function IsNotWaitingForBGMStop(): boolean {
  return true;
}
