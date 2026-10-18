import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { OverworldScene } from './scenes/OverworldScene';
import { BattleScene } from './scenes/BattleScene';
import { FieldMenuScene } from './scenes/FieldMenuScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { testHooks } from './dev/testHooks';
import { startAudioOutput } from './audio/output';
import { listenForOutputKeys } from './input/Input';

// GBA native resolution; scaled up with nearest-neighbour filtering.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 240,
  height: 160,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MainMenuScene, OverworldScene, BattleScene, FieldMenuScene],
  // Sound is the m4a engine's, played by audio/output.ts: no second AudioContext from Phaser (AUDIO_PLAN.md decision 7).
  audio: { noAudio: true },
});

// The sound output: suspended until the first key press or click, M mutes it.
startAudioOutput(listenForOutputKeys);

// Handy for poking at state from the devtools console during development; `__test` drives the e2e tests.
if (import.meta.env.DEV) {
  (window as unknown as { game: Phaser.Game }).game = game;
  testHooks.install(game);
}
