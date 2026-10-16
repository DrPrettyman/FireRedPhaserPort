import Phaser from 'phaser';
import { Assets } from '../data/assets';
import { presetFromUrl, presetStart } from '../dev/startPresets';
import { gSave, LoadGameSave, SAVE_STATUS_EMPTY } from '../state/save';
import type { MainMenuStart } from './MainMenuScene';
import type { OverworldStart } from './OverworldScene';

/** New game warp target (src/new_game.c: SetWarpDestination(..PLAYERS_HOUSE_2F, -1, 6, 6)). */
const NEW_GAME_START: OverworldStart = { map: 'PalletTown_PlayersHouse_2F', x: 6, y: 6 };

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  /** `softReset`: SoftReset(RESET_ALL) from the credits (menus/credits.ts): the boot flow again, ignoring dev starts. */
  async create(data?: { softReset?: boolean }): Promise<void> {
    const assets = new Assets();
    try {
      await assets.init();
    } catch (err) {
      console.error(err);
      this.add
        .text(8, 8, 'Assets missing.\nRun: npm run extract', { fontFamily: 'monospace', fontSize: '10px', color: '#f88' })
        .setResolution(4);
      return;
    }
    this.registry.set('assets', assets);
    const save = LoadGameSave(); // sets gSaveFileStatus, which the save dialog checks too
    const dev = data?.softReset ? undefined : startFromUrl();
    // No title screen yet: boot into the main menu (CB2_InitMainMenu), which with an empty slot goes on to the new
    // game at once (Task_SetWin0BldRegsNoSaveFileCheck → NEW GAME), so skip it then. Dev starts skip it too.
    if (dev || gSave.fileStatus === SAVE_STATUS_EMPTY) this.scene.start('Overworld', dev ?? NEW_GAME_START);
    else this.scene.start('MainMenu', { saveFileStatus: gSave.fileStatus, save, newGame: NEW_GAME_START } satisfies MainMenuStart);
  }
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
