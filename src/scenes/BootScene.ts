import Phaser from 'phaser';
import { Assets } from '../data/assets';
import { loadAudioData } from '../audio/audioData';
import { AgbMainSoundInit } from '../audio/frame';
import { presetFromUrl, presetStart } from '../dev/startPresets';
import { gSave, LoadGameSave, SAVE_STATUS_EMPTY } from '../state/save';
import type { MainMenuStart } from './MainMenuScene';
import type { OverworldStart } from './OverworldScene';

/** New game warp target (src/new_game.c: SetWarpDestination(..PLAYERS_HOUSE_2F, -1, 6, 6)). */
const NEW_GAME_START: OverworldStart = { map: 'PalletTown_PlayersHouse_2F', x: 6, y: 6 };

export interface BootStart {
  /** DoSoftReset: boot again (to the title screen), ignoring the URL's dev starts. */
  softReset?: boolean;
}

/**
 * Boot: load the extracted data, then the title screen (title_screen.c; the copyright screen and intro.c's
 * Game Freak / Nidorino movie before it aren't ported). Dev starts (`?start=`, `?map=`) go straight into the
 * field; `?skipIntro` (dev, used by the e2e harness) boots like the port did before the title screen existed:
 * into the main menu when the save slot holds something, else straight into the new game, and NEW GAME skips Oak's
 * speech.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  async create(data?: BootStart): Promise<void> {
    let assets: Assets | undefined = this.registry.get('assets');
    if (!assets) {
      assets = new Assets();
      try {
        await Promise.all([assets.init(), loadAudioData()]);
      } catch (err) {
        console.error(err);
        this.add
          .text(8, 8, 'Assets missing.\nRun: npm run extract', { fontFamily: 'monospace', fontSize: '10px', color: '#f88' })
          .setResolution(4);
        return;
      }
      this.registry.set('assets', assets);
    }
    AgbMainSoundInit(); // m4aSoundInit + InitMapMusic, before the first frame (also on a soft reset)
    LoadGameSave(); // sets gSaveFileStatus, which the save dialog checks too (the title screen loads it again)
    const dev = data?.softReset ? undefined : startFromUrl();
    if (dev) {
      this.scene.start('Overworld', dev);
    } else if (skipIntro()) {
      // The main menu with an empty slot goes on to the new game at once (Task_SetWin0BldRegsNoSaveFileCheck →
      // NEW GAME), so skip it then.
      if (gSave.fileStatus === SAVE_STATUS_EMPTY) this.scene.start('Overworld', NEW_GAME_START);
      else this.scene.start('MainMenu', { entry: 'mainMenu', newGame: NEW_GAME_START, skipOakSpeech: true } satisfies MainMenuStart);
    } else {
      this.scene.start('MainMenu', { entry: 'title', newGame: NEW_GAME_START } satisfies MainMenuStart);
    }
  }
}

/**
 * DoSoftReset (the clear save data screen, the end of the credits): stop every scene and boot again, which shows
 * the title screen (with ?skipIntro: the main menu or the new game). The extracted data stays loaded; everything
 * else starts fresh. SoftReset clears RAM, but Phaser reuses a stopped scene's instance with all its fields, so the
 * Overworld (whose fields hold the field's state) is replaced by a new instance. Call it from a scene's own code
 * (a GBA host should stopHost() first, as MainMenuScene's clear save data screen does).
 */
export function softReset(from: Phaser.Scene): void {
  const game = from.game;
  for (const s of game.scene.getScenes(false)) {
    if (s.scene.key === 'Boot') continue;
    if (s === from || s.scene.isActive() || s.scene.isSleeping() || s.scene.isPaused() || s.scene.isVisible()) s.scene.stop();
  }
  const Overworld = game.scene.getScene('Overworld').constructor as new () => Phaser.Scene;
  game.scene.remove('Overworld');
  // The removal is queued while the scenes update: wait until it has happened
  const reboot = () => {
    if (game.scene.getScene('Overworld')) {
      game.events.once(Phaser.Core.Events.POST_STEP, reboot);
      return;
    }
    game.scene.add('Overworld', Overworld, false);
    game.scene.moveAbove('MainMenu', 'Overworld'); // back to its place in main.ts's scene list
    game.scene.start('Boot', { softReset: true } satisfies BootStart);
  };
  game.events.once(Phaser.Core.Events.POST_STEP, reboot);
}

/** `?skipIntro` (dev builds only): no title screen. */
function skipIntro(): boolean {
  return import.meta.env.DEV && new URLSearchParams(location.search).has('skipIntro');
}

/**
 * Debug: ?map=PalletTown&x=10&y=10 jumps straight to a location; ?start=after-rival[&starter=squirtle]
 * starts after Oak's lab and the first rival battle (in the lab, or at ?map=&x=&y= if given);
 * ?start=evolution is that plus a party set up to evolve, next to a Viridian Forest trainer.
 */
function startFromUrl(): OverworldStart | undefined {
  const q = new URLSearchParams(location.search);
  const map = q.get('map');
  const at = map ? { map, x: Number(q.get('x') ?? 0), y: Number(q.get('y') ?? 0) } : undefined;
  const preset = presetFromUrl(q);
  if (preset) return { ...(at ?? presetStart(preset)), preset };
  return at;
}
